import type { DiagramJson } from '../ai/types'
import { normalizeCanvas } from '../rules/designCanvas'
import type { DesignNotes } from '../rules/designDigest'
import { normalizeNotes } from '../rules/designNotes'
import { removeKey, writeJson } from '../lib/storage'
import type { DojoDB } from './db'

/**
 * The edited parts of a drawing session (notes / canvas / view), stashed synchronously (localStorage) while the page is going
 * away. The notes are written on every keystroke, but IndexedDB cannot be waited on once the page is torn down: a read-modify-write
 * still in flight at that moment is lost with the page, and so is a plain write issued in the same tick. A synchronous stash
 * survives; the next load applies it (through the normal write path, so disk sync sees it) before the screen shows the session.
 * The stored data shape is unchanged: this is a hand-over slot, not a second copy of the data.
 *
 * Rules that keep it from doing harm:
 * - only a window that has unsaved edits stashes, and only the parts it edited (an untouched session leaves nothing, so
 *   opening one never writes);
 * - `known[part]` lists hashes of the stored value of that part that this window started from or wrote itself. The stash is
 *   applied only when the stored part is still one of them (or already equals the stash); a row that another window changed
 *   since is newer, so the stash is dropped;
 * - what is applied is normalised (the same caps as the editors), and an oversized or malformed slot is ignored;
 * - a slot is removed only once it is settled (applied, equal, stale, or the session is no longer drawing); a failed write keeps it;
 * - sessions that are over leave no slot behind (sweepPending), and a discarded session can never be stashed again.
 */
export interface PendingDrawing {
  nonce: string
  notes?: DesignNotes
  canvas?: DiagramJson
  view?: '2d' | 'iso'
  known: { notes?: string[]; canvas?: string[]; view?: string[] }
}
export type Part = 'notes' | 'canvas' | 'view'
export const PARTS: readonly Part[] = ['notes', 'canvas', 'view']
/** the parts of a session a stash can carry, as they are (or were) stored */
export type Resolved = { notes?: DesignNotes; canvas?: DiagramJson; view?: '2d' | 'iso' }

const PREFIX = 'dojo-design-pending:'
const key = (id: string) => `${PREFIX}${id}`
/** A real stash is a few tens of KB (7 texts of 2000 chars, 12 tables of 16 columns, the canvas); far above that is not ours. */
const MAX_RAW = 400_000
const MAX_KNOWN = 16
let counter = 0
const blocked = new Set<string>()

function stable(v: unknown): string {
  if (v === undefined) return 'u'
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).sort().filter(k => o[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`
}

/** A short fingerprint of a stored part (key order and undefined fields do not matter). */
export function partHash(v: unknown): string {
  const s = stable(v)
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const hashes = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((h): h is string => typeof h === 'string' && h.length > 0 && h.length < 32).slice(-MAX_KNOWN) : undefined

/** Shape check of a parsed slot; the parts are cut down by `normalise` before they go anywhere. */
function parse(v: unknown): PendingDrawing | null {
  if (!isObj(v) || typeof v.nonce !== 'string' || !v.nonce) return null
  const out: PendingDrawing = { nonce: v.nonce, known: {} }
  if (v.notes !== undefined) { if (!isObj(v.notes)) return null; out.notes = v.notes as unknown as DesignNotes }
  if (v.canvas !== undefined) { if (!isObj(v.canvas)) return null; out.canvas = v.canvas as unknown as DiagramJson }
  if (v.view !== undefined) { if (v.view !== '2d' && v.view !== 'iso') return null; out.view = v.view }
  if (!out.notes && !out.canvas && !out.view) return null
  if (v.known !== undefined) {
    if (!isObj(v.known)) return null
    for (const p of PARTS) { const h = hashes(v.known[p]); if (h) out.known[p] = h }
  }
  return out
}

/** Stash the snapshot (only the parts given); returns its nonce, so a later clear only removes this very stash. Null when
 * the session was discarded. */
export function stashPending(id: string, snap: Omit<PendingDrawing, 'nonce'>): string | null {
  if (blocked.has(id)) return null
  const nonce = `${Date.now()}-${++counter}`
  writeJson(key(id), { ...snap, nonce })
  return nonce
}

/** The stash of a session, or null when there is none or it is malformed or oversized (which is then removed). */
export function readPending(id: string): PendingDrawing | null {
  let raw: string | null = null
  try { raw = localStorage.getItem(key(id)) } catch { return null }
  if (raw === null) return null
  let slot: PendingDrawing | null = null
  if (raw.length <= MAX_RAW) {
    try { slot = parse(JSON.parse(raw)) } catch { slot = null }
  }
  if (!slot) removeKey(key(id))
  return slot
}

/** Remove the stash; with a nonce only when it is still that stash (a newer one stays). */
export function clearPending(id: string, nonce?: string): void {
  if (nonce !== undefined) {
    let raw: string | null = null
    try { raw = localStorage.getItem(key(id)) } catch { return }
    if (raw !== null) {
      try { if ((JSON.parse(raw) as { nonce?: unknown })?.nonce !== nonce) return } catch { /* corrupt: remove it */ }
    }
  }
  removeKey(key(id))
}

/** A session being discarded: drop its stash and refuse any later one (a hidden event can still fire before the page notices). */
export function blockPending(id: string): void {
  blocked.add(id)
  removeKey(key(id))
}

/** Remove the stash of every session that is not drawing any more (done, locked, discarded, never there). */
export async function sweepPending(d: DojoDB): Promise<void> {
  let ids: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(PREFIX)) ids.push(k.slice(PREFIX.length))
    }
  } catch { return }
  ids = [...new Set(ids)]
  if (!ids.length) return
  const rows = await d.designSessions.bulkGet(ids)
  ids.forEach((id, i) => { if (rows[i]?.phase !== 'drawing') removeKey(key(id)) })
}

/** The parts of a stash as they will be stored (the editors' caps applied). */
export function normalise(p: PendingDrawing): Resolved {
  const out: Resolved = {}
  if (p.notes) out.notes = normalizeNotes(p.notes)
  if (p.canvas) out.canvas = normalizeCanvas(p.canvas)
  if (p.view) out.view = p.view
  return out
}

/**
 * Apply a stash to the stored session in one transaction. Resolves with the parts that are now stored (the stash laid on the
 * row, or `{}` when it was dropped as stale or because the session is not drawing any more); the stash is removed in every
 * resolved case. A failed write rejects and leaves the stash for the next load. Writes nothing when the row already holds it.
 */
export async function applyPending(d: DojoDB, id: string, p: PendingDrawing): Promise<Resolved> {
  const want = normalise(p)
  const parts = PARTS.filter(k => want[k] !== undefined)
  const res = await d.transaction('rw', d.designSessions, async (): Promise<Resolved> => {
    const s = await d.designSessions.get(id)
    if (!s || s.phase !== 'drawing') return {}
    let write = false
    for (const k of parts) {
      const have = partHash(s[k])
      if (have === partHash(want[k])) continue
      if (!p.known[k]?.includes(have)) return {}
      write = true
    }
    if (write) await d.designSessions.put({ ...s, ...want })
    return want
  })
  clearPending(id, p.nonce)
  return res
}

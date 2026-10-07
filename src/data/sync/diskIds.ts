// Disk ids for the append-only tables (I3). events, aiLog and atlasRuns use Dexie `++seq`, so every
// browser numbers its rows 1, 2, 3... On disk such a row is `${clientId}:${seq}` of the browser that
// created it, and the disk doc carries that id as `_diskId` (and no local `seq`).
//
// Hydrating these rows into a browser gives them FRESH local seqs (1..n in chronological order) and
// keeps `_diskId` on the row, so a later edit maps back to the same disk doc. We do not keep the
// original seq: two browsers both write seq 101, and one Dexie table cannot hold two rows at key 101.
// Rows that point at another row by seq (an undo's `of`) carry the target's disk id as `_ofDiskId`
// on disk, and hydrate rewrites `of` to the target's new local seq.
import { keyToId } from './keys'

export const APPEND_ONLY = new Set(['events', 'aiLog', 'atlasRuns'])

type Doc = Record<string, unknown>
const isDoc = (d: unknown): d is Doc => d !== null && typeof d === 'object' && !Array.isArray(d)

/** The disk id of a row: its own `_diskId` (hydrated rows), else `${clientId}:${seq}` for append-only tables. */
export function diskIdOf(tbl: string, key: unknown, doc: unknown, clientId: string): string {
  if (!APPEND_ONLY.has(tbl)) return keyToId(key)
  const own = isDoc(doc) ? doc._diskId : undefined
  return typeof own === 'string' && own ? own : `${clientId}:${keyToId(key)}`
}

/** True when the row came from the disk (an edit of a known doc, possibly created by another browser). */
export function isKnownDiskRow(doc: unknown): boolean {
  return isDoc(doc) && typeof doc._diskId === 'string' && doc._diskId !== ''
}

/**
 * The doc as stored on disk. Append-only rows drop their local `seq`, gain `_diskId`, and an undo
 * gains `_ofDiskId` (resolved by `ofTarget`, which returns the disk id of the row at a local seq).
 */
export function toDiskDoc(tbl: string, id: string, doc: unknown, ofTarget?: (seq: number) => string | undefined): unknown {
  if (!APPEND_ONLY.has(tbl) || !isDoc(doc)) return doc
  const { seq: _seq, ...rest } = doc
  const out: Doc = { ...rest, _diskId: id }
  if (typeof doc.of === 'number' && ofTarget) {
    const target = ofTarget(doc.of)
    if (target) out._ofDiskId = target
  }
  return out
}

const suffix = (id: string) => {
  const n = Number(id.slice(id.lastIndexOf(':') + 1))
  return Number.isFinite(n) ? n : 0
}

/**
 * Disk docs of an append-only table as local rows: chronological (by `at`, then creator, then the
 * creator's seq), numbered 1..n, with `of` rewritten from `_ofDiskId`. Explicit seqs are safe: the
 * table is cleared in the same transaction, and IndexedDB advances its key generator past them.
 */
export function fromDiskDocs(tbl: string, docs: unknown[]): unknown[] {
  // `code` is keyed (ticketId, lang). A disk still holding a 4a doc (id = ticketId) beside its 4b
  // replacement has two docs for one key: the newest wins, and a doc without a key is not a row.
  if (tbl === 'code') {
    // A 4a-style doc (id = ticketId) may carry no `lang`: it is Go's.
    return docs.filter(isDoc).map(d => (d.lang === undefined ? { ...d, lang: 'go' } : d))
      .filter(d => typeof d.ticketId === 'string' && (d.lang === 'go' || d.lang === 'py'))
      .sort((a, b) => Number((a as Doc).updatedAt ?? 0) - Number((b as Doc).updatedAt ?? 0))
  }
  if (!APPEND_ONLY.has(tbl)) return docs
  const rows = docs.filter(isDoc).map(d => ({ ...d }))
  const creator = (d: Doc) => String(d._diskId ?? '').slice(0, Math.max(0, String(d._diskId ?? '').lastIndexOf(':')))
  rows.sort((x, y) => {
    const ax = typeof x.at === 'number' ? x.at : 0
    const ay = typeof y.at === 'number' ? y.at : 0
    if (ax !== ay) return ax - ay
    const cx = creator(x), cy = creator(y)
    if (cx !== cy) return cx < cy ? -1 : 1
    return suffix(String(x._diskId ?? '')) - suffix(String(y._diskId ?? ''))
  })
  const seqOf = new Map<string, number>()
  rows.forEach((r, i) => {
    r.seq = i + 1
    if (typeof r._diskId === 'string') seqOf.set(r._diskId, i + 1)
  })
  for (const r of rows) {
    if (typeof r.of === 'number') {
      // An unresolvable reference must point at nothing, never at whichever row now holds that number.
      const target = typeof r._ofDiskId === 'string' ? seqOf.get(r._ofDiskId) : undefined
      r.of = target ?? -1
    }
    delete r._ofDiskId
  }
  return rows
}

import type {
  AiLogRow, BankItem, CheckAttemptRow, CodeRow, DesignSession, GradeRow, PictureRow, Redo, RungUse, Session, StoredEvent, Ticket,
} from '../data/types'

export type IdMap = ReadonlyMap<string, string>
/** Identity pairs drop out. A `to` that is also a `from` (a chain or a cycle) has no single-hop meaning, so it throws. */
export function idMapOfPairs(pairs: ReadonlyArray<{ from: string; to: string }>): IdMap {
  const live = pairs.filter(p => p.from !== p.to)
  const froms = new Set(live.map(p => p.from))
  const bad = live.find(p => froms.has(p.to))
  if (bad) throw new Error(`remap: chained or cyclic id pairs are not supported ('${bad.from}' -> '${bad.to}' and '${bad.to}' is also renamed)`)
  return new Map(live.map(p => [p.from, p.to] as const))
}

const sub = (id: string, m: IdMap): string => m.get(id) ?? id
function setKey<T extends object>(row: T, key: string, m: IdMap): T {
  const v = (row as Record<string, unknown>)[key]
  return typeof v === 'string' && m.has(v) ? ({ ...row, [key]: m.get(v) } as T) : row
}

export function remapSession(s: Session, m: IdMap): Session {
  const out = setKey(s, 'ticketId', m)
  return s.cards?.some(c => m.has(c)) ? { ...out, cards: s.cards.map(c => sub(c, m)) } : out
}
export const remapRedo = (r: Redo, m: IdMap): Redo => setKey(r, 'ticketId', m)
export const remapRungUse = (r: RungUse, m: IdMap): RungUse => setKey(r, 'ticketId', m)
export const remapCheckAttempt = (r: CheckAttemptRow, m: IdMap): CheckAttemptRow => setKey(r, 'ticketId', m)
export const remapCode = (r: CodeRow, m: IdMap): CodeRow => setKey(r, 'ticketId', m)
export const remapBankItem = (r: BankItem, m: IdMap): BankItem => setKey(r, 'ticketId', m)
export const remapDesignSession = (r: DesignSession, m: IdMap): DesignSession => setKey(r, 'designId', m)
export const remapAiLog = (r: AiLogRow, m: IdMap): AiLogRow => setKey(r, 'ticketId', m)
export const remapGrade = (g: GradeRow, m: IdMap): GradeRow => (g.targetKind === 'ticket' ? setKey(g, 'targetId', m) : g)
export const remapPicture = (p: PictureRow, m: IdMap): PictureRow => setKey(p, 'key', m)

type SplitRefs = { childOf?: string; children?: string[] }
/** A ticket's links to other tickets: `origin` (a split session's origin is its parent), `childOf`, `children`. */
export function remapTicketRefs(t: Ticket, m: IdMap): Ticket {
  const l = t as Ticket & SplitRefs
  let out: Ticket = setKey(t, 'origin', m)
  out = setKey(out, 'childOf', m)
  if (l.children?.some(c => m.has(c))) out = { ...out, children: l.children.map(c => sub(c, m)) } as Ticket
  return out
}

/** An event's ticket ids: `id`, `ids[]`, `parts[]` and the keys of a `to` map (shift_plan). */
export function remapEvent(e: StoredEvent, m: IdMap): StoredEvent {
  const r = e as unknown as Record<string, unknown>
  let out: Record<string, unknown> | null = null
  const set = (k: string, v: unknown) => { out ??= { ...r }; out[k] = v }
  if (typeof r.id === 'string' && m.has(r.id)) set('id', m.get(r.id))
  for (const k of ['ids', 'parts']) {
    const v = r[k]
    if (Array.isArray(v) && v.some(x => typeof x === 'string' && m.has(x))) set(k, v.map(x => (typeof x === 'string' ? sub(x, m) : x)))
  }
  const to = r.to
  if (to && typeof to === 'object' && !Array.isArray(to) && Object.keys(to).some(k => m.has(k))) {
    const next: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(to)) next[sub(k, m)] = v
    set('to', next)
  }
  return (out ?? e) as StoredEvent
}

export interface RemapRows {
  sessions: Session[]; redos: Redo[]; rungUses: RungUse[]; checkAttempts: CheckAttemptRow[]; code: CodeRow[]; grades: GradeRow[]
  bankItems: BankItem[]; designSessions: DesignSession[]; events: StoredEvent[]; aiLog: AiLogRow[]; pictures: PictureRow[]
}

/** The marker line MIG-08 puts between a merged code row's newest source and the older source kept below it. */
export const CODE_MERGE_MARKER = 'earlier code kept by the R1 migration'

/** Line-comment token of a language: `#` for python, ruby, shell and yaml; `--` for sql and haskell; `//` for everything else. */
export function commentToken(lang: string): string {
  switch (lang.toLowerCase()) {
    case 'py': case 'python': case 'rb': case 'ruby': case 'sh': case 'bash': case 'zsh': case 'shell': case 'yaml': case 'yml':
      return '#'
    case 'sql': case 'hs': case 'haskell':
      return '--'
    default:
      return '//'
  }
}

/** Every line commented out, an empty line becoming the bare token (no trailing space). */
const commentOut = (source: string, tok: string): string => source.split('\n').map(l => (l === '' ? tok : `${tok} ${l}`)).join('\n')

/** A code row with the id it had before any remap: the tie-break key of a merge. */
export interface CodeGroupEntry { orig: string; row: CodeRow }

/**
 * MIG-08: all rows that land on one (container, language). Newest first by `updatedAt`, ties by the ORIGINAL ticket id ascending
 * (the container's own id sorts before its `~n` parts), so the result does not depend on the input order. The newest source stays as is;
 * each older source follows, in turn, after a blank line and a marker line, fully commented out, so no source text is lost.
 * Everything else is the newest row's, except `lastLang`: it is true when any row of the group had it (otherwise the newest row's value,
 * with no key added), so the panel does not reopen on another language because a merge dropped the mark.
 * Shared by the pure remap (unsplit, plan renames) and the data layer's rename (`remapTicketIds`).
 */
export function mergeCodeGroup(entries: ReadonlyArray<CodeGroupEntry>): CodeRow {
  const sorted = [...entries].sort((a, b) => b.row.updatedAt - a.row.updatedAt || (a.orig < b.orig ? -1 : a.orig > b.orig ? 1 : 0))
  const [{ row: top }, ...older] = sorted
  if (older.length === 0) return top
  const tok = commentToken(top.lang)
  let source = top.source
  for (const { row: o } of older) {
    source += `${source.endsWith('\n') ? '\n' : '\n\n'}${tok} ${CODE_MERGE_MARKER}\n${commentOut(o.source, tok)}`
  }
  const merged: CodeRow = { ...top, source }
  if (sorted.some(e => e.row.lastLang)) merged.lastLang = true
  return merged
}

/** Remaps the tables present in `s` (the tickets table is handled by the caller). */
export function remapRows<T extends Partial<RemapRows>>(s: T, m: IdMap): { rows: T; collisions: { code: number; pictures: number } } {
  const out: Partial<RemapRows> = {}
  if (s.sessions) out.sessions = s.sessions.map(r => remapSession(r, m))
  if (s.redos) out.redos = s.redos.map(r => remapRedo(r, m))
  if (s.rungUses) out.rungUses = s.rungUses.map(r => remapRungUse(r, m))
  if (s.checkAttempts) out.checkAttempts = s.checkAttempts.map(r => remapCheckAttempt(r, m))
  if (s.grades) out.grades = s.grades.map(r => remapGrade(r, m))
  if (s.bankItems) out.bankItems = s.bankItems.map(r => remapBankItem(r, m))
  if (s.designSessions) out.designSessions = s.designSessions.map(r => remapDesignSession(r, m))
  if (s.events) out.events = s.events.map(r => remapEvent(r, m))
  if (s.aiLog) out.aiLog = s.aiLog.map(r => remapAiLog(r, m))
  let codeCollisions = 0
  if (s.code) {
    // MIG-08: group by (container, lang) in first-seen order; a group of several rows becomes one merged row
    const groups = new Map<string, CodeGroupEntry[]>()
    for (const r of s.code) {
      const row = remapCode(r, m)
      const k = `${row.ticketId}:${row.lang}`
      groups.set(k, [...(groups.get(k) ?? []), { orig: r.ticketId, row }])
    }
    out.code = [...groups.values()].map(g => {
      codeCollisions += g.length - 1
      return mergeCodeGroup(g)
    })
  }
  let pictureCollisions = 0
  if (s.pictures) {
    const best = new Map<string, PictureRow>()
    for (const p of s.pictures.map(r => remapPicture(r, m))) {
      const cur = best.get(p.key)
      if (cur) pictureCollisions++
      if (!cur || p.createdAt >= cur.createdAt) best.set(p.key, p)
    }
    out.pictures = [...best.values()]
  }
  return { rows: { ...s, ...out } as T, collisions: { code: codeCollisions, pictures: pictureCollisions } }
}

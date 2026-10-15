import type { Ticket } from '../data/types'
import { isOffPlanOrigin } from './bankTickets'
import { needsModeRewrite } from './designMode'
import type { FlatState } from './flatState'
import { resolveId, STATUS_RANK } from './reconcile'
import { promotedStatus } from './unsplit'
import { totalXp } from './xp'

/** `info` results are always ok: they report a fact (the rehearsal prints them as INFO) and are never a failure. */
export interface InvariantResult { name: string; ok: boolean; detail: string; info?: boolean }
type Legacy = Ticket & { children?: string[]; childOf?: string }

export class MigrationInvariantError extends Error {
  constructor(message: string) { super(message); this.name = 'MigrationInvariantError' }
}

/** The acceptance invariants of spec 3.2 "Rehearsal" and contracts MIG-04 to 15. Pure; used by the core, the tests and the rehearsal. */
export function checkFlatInvariants(before: FlatState, after: FlatState, planIds: ReadonlySet<string>, codeMerged = 0, renameTargets: ReadonlySet<string> = new Set()): InvariantResult[] {
  const r: InvariantResult[] = []
  const check = (name: string, ok: boolean, detail = '') => r.push({ name, ok, detail: ok ? detail : detail || 'violated' })
  const ids = new Set(after.tickets.map(t => t.id))

  check('total XP unchanged', totalXp(before.tickets) === totalXp(after.tickets), `${totalXp(before.tickets)} -> ${totalXp(after.tickets)}`)
  // MIG-05: the migration must not orphan a row. A row that already pointed at no ticket before the run (bank/Mine un-tick, a pre-R1
  // undoSplit) is not the migration's doing; failing on it would stop every boot, so it is reported (info) and tolerated.
  const beforeIds = new Set(before.tickets.map(t => t.id))
  // rows are matched by id: the `after` row may carry a remapped ticketId, so "resolved before" is read from the `before` row
  const resolvedBefore = (rows: ReadonlyArray<{ id: string; ticketId: string }>): ReadonlySet<string> => new Set(rows.filter(x => beforeIds.has(x.ticketId)).map(x => x.id))
  const sessionsOk = resolvedBefore(before.sessions)
  const redosOk = resolvedBefore(before.redos)
  const lostSessions = after.sessions.filter(s => sessionsOk.has(s.id) && !ids.has(s.ticketId)).map(s => s.id)
  check('sessions preserved and every one resolves', before.sessions.length === after.sessions.length && lostSessions.length === 0, lostSessions.join(', '))
  const lostRedos = after.redos.filter(x => redosOk.has(x.id) && !ids.has(x.ticketId)).map(x => x.id)
  check('redos resolve', lostRedos.length === 0, lostRedos.join(', '))
  const orphanSessions = before.sessions.filter(s => !beforeIds.has(s.ticketId)).length
  // a `bank_q` redo (R1 W6) holds a question id, not a ticket id: it is never an orphan
  const orphanRedos = before.redos.filter(x => x.source !== 'bank_q' && !beforeIds.has(x.ticketId)).length
  r.push({ name: `pre-existing orphan sessions: ${orphanSessions}`, ok: true, detail: '', info: true })
  r.push({ name: `pre-existing orphan redos: ${orphanRedos}`, ok: true, detail: '', info: true })
  // R1 W6: the question-bank tables are not the migration's business: their rows come out exactly as they went in
  for (const k of ['bankGrades', 'bankExtra'] as const) check(`${k} rows unchanged`, JSON.stringify(before[k] ?? []) === JSON.stringify(after[k] ?? []))
  const split = after.tickets.filter(t => ((t as Legacy).children?.length ?? 0) > 0 || (t as Legacy).childOf !== undefined).map(t => t.id)
  check('no ticket has children or childOf', split.length === 0, split.join(', '))
  const strays = after.tickets.filter(t => !t.archived && !isOffPlanOrigin(t.origin) && !planIds.has(t.id)).map(t => t.id)
  check('every live non-bank ticket is in the plan', strays.length === 0, strays.slice(0, 5).join(', '))
  check('no design session keeps the interviewer mode', after.designSessions.every(s => !needsModeRewrite(s.mode)))
  const byId = new Map(after.tickets.map(t => [t.id, t]))
  const changed: string[] = []
  for (const t of before.tickets) {
    if (!planIds.has(t.id) || t.archived) continue
    const parts = before.tickets.filter(p => (p as Legacy).childOf === t.id && !p.archived)
    const want = ((t as Legacy).children?.length ?? 0) > 0 ? promotedStatus(parts) ?? t.status : t.status
    const got = byId.get(t.id)
    if (!got || got.status === want) continue
    // a plan idMap rename target may only be lifted: reconcile's mergeOnto gives it the highest status of every row merged onto it,
    // so a done vanished ticket merged into a todo target legitimately lifts the target. A target that ends BELOW its own
    // before-status (done -> todo) is still a regression.
    if (renameTargets.has(t.id) && STATUS_RANK[got.status] >= STATUS_RANK[want]) continue
    changed.push(t.id)
  }
  check('kept ids keep their status', changed.length === 0, changed.join(', '))
  const orders = after.tickets.filter(t => !t.archived && t.origin === 'plan').map(t => t.order)
  check('live plan orders are unique', new Set(orders).size === orders.length)
  // MIG-13: the stage kind may remain on archived legacy tickets only
  const stages = after.tickets.filter(t => !t.archived && t.kind === 'stage').map(t => t.id)
  check('no live ticket has kind stage', stages.length === 0, stages.slice(0, 5).join(', '))
  // MIG-13: every plan AI ticket (lane path) carries its stamps
  const unstamped = after.tickets
    .filter(t => !t.archived && t.origin === 'plan' && t.lane === 'path')
    .filter(t => !(t.lane && t.node && t.area && typeof t.phase === 'number' && Number.isFinite(t.order)))
    .map(t => t.id)
  check('every live plan path ticket carries lane, node, area, phase and order', unstamped.length === 0, unstamped.slice(0, 5).join(', '))
  check('modelVersion is 2', after.settings.modelVersion === 2)
  for (const k of ['rungUses', 'checkAttempts', 'grades', 'bankItems', 'designSessions', 'aiLog'] as const) {
    check(`${k} row count unchanged`, before[k].length === after[k].length, `${before[k].length} -> ${after[k].length}`)
  }
  // MIG-08: the only count that may change is `code`, by exactly the rows folded into another one
  check('code row count drops by exactly codeMerged', after.code.length === before.code.length - codeMerged, `${before.code.length} -> ${after.code.length}, codeMerged ${codeMerged}`)
  // MIG-08: and no source text is lost. Every non-empty line of a `before` code source is still in the row it merged into
  // (as is, or behind a comment token). The line may sit in the row at the ticket's own id or in the row at its `mergedInto` target (a folded
  // split session); when neither row exists (a plan rename moved the id) any row of the same language will do.
  const lostLines = lostCodeLines(before, after)
  check('merged code rows keep every earlier source line', lostLines.length === 0, lostLines.slice(0, 3).join('; '))
  return r
}

const COMMENT_PREFIX = /^(#|\/\/|--) ?/
const linesOf = (source: string): string[] => source.split('\n').map(l => l.trim()).filter(l => l !== '')

function lostCodeLines(before: FlatState, after: FlatState): string[] {
  const mergedInto = new Map(after.tickets.filter(t => t.mergedInto !== undefined).map(t => [t.id, t.mergedInto as string] as const))
  const have = new Map<string, Set<string>>() // `${ticketId}:${lang}` -> trimmed lines, plain and with a leading comment token removed
  const byLang = new Map<string, Set<string>>()
  for (const c of after.code) {
    const set = (m: Map<string, Set<string>>, k: string) => m.get(k) ?? m.set(k, new Set()).get(k)!
    const a = set(have, `${c.ticketId}:${c.lang}`)
    const b = set(byLang, c.lang)
    for (const l of linesOf(c.source)) {
      for (const x of new Set([l, l.replace(COMMENT_PREFIX, '').trim()])) { a.add(x); b.add(x) }
    }
  }
  const lost: string[] = []
  for (const c of before.code) {
    // a line is kept when ANY candidate row has it: the row still at the ticket's own id (unchanged rows, also a dropped
    // container's parts) or the row it folded into (`mergedInto`). Only when neither row exists (a plan rename moved the
    // id) does any row of the language count. `childOf` is deliberately not consulted: a part that was not folded keeps its own row.
    const pools = [have.get(`${c.ticketId}:${c.lang}`), have.get(`${mergedInto.get(c.ticketId)}:${c.lang}`)].filter((x): x is Set<string> => x !== undefined)
    if (pools.length === 0) pools.push(byLang.get(c.lang) ?? new Set<string>())
    for (const l of linesOf(c.source)) if (!pools.some(p => p.has(l))) lost.push(`${c.ticketId}:${c.lang} lost "${l.slice(0, 40)}"`)
  }
  return lost
}

/** The live plan ids that at least one vanished (not in the plan, not bank/Mine) ticket in `before` is renamed onto through the plan's idMap. */
export function renameTargetsOf(before: FlatState, idMap: Record<string, string>, planIds: ReadonlySet<string>): Set<string> {
  const out = new Set<string>()
  for (const t of before.tickets) {
    if (planIds.has(t.id) || isOffPlanOrigin(t.origin)) continue
    const to = resolveId(t.id, idMap, x => planIds.has(x))
    if (to) out.add(to)
  }
  return out
}

export function assertFlat(before: FlatState, after: FlatState, planIds: ReadonlySet<string>, codeMerged = 0, renameTargets: ReadonlySet<string> = new Set()): void {
  const bad = checkFlatInvariants(before, after, planIds, codeMerged, renameTargets).filter(x => !x.ok)
  if (bad.length) throw new MigrationInvariantError(`flat migration refused: ${bad.map(b => `${b.name} (${b.detail})`).join('; ')}`)
}

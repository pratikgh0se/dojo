import type { DesignSession, DojoEvent, ReplanReport } from '../data/types'
import { rewriteLegacyMode } from './designMode'
import type { PlanV2 } from '../data/planV2'
import { isOffPlanOrigin } from './bankTickets'
import { assertFlat } from './flatInvariants'
import type { FlatState } from './flatState'
import { idMapOf, planToTickets, planVersionOf } from './planTickets'
import { budgetsOf, MIN_CORE_MINUTES, weeklyTotal } from './prefs'
import { reconcilePlan } from './reconcile'
import { idMapOfPairs, remapRows } from './remapIds'
import { unsplit } from './unsplit'
import { possibleXp, totalXp } from './xp'

export { MigrationInvariantError } from './flatInvariants'

/** The pre-flat default for coreMinutes (MIG-20). */
const OLD_DEFAULT_CORE_MINUTES = 1440

export interface FlatOptions { now: number; backupFile: string | null }
export interface FlatResult { next: FlatState; newEvents: DojoEvent[]; report: ReplanReport | null }

/** The pure core of the flat migration (spec 3.2): in-memory state in, new state, new events and the report out. */
export function migrateToFlat(state: FlatState, plan: PlanV2, opts: FlatOptions): FlatResult {
  const content = planToTickets(plan)
  const planIds = new Set(content.map(c => c.id))
  const migrating = state.settings.modelVersion !== 2
  const xpBefore = totalXp(state.tickets)
  const beforeById = new Map(state.tickets.map(t => [t.id, t]))

  const u = unsplit(state, planIds, opts.now)
  const rec = reconcilePlan(u.state.tickets, content, idMapOf(plan))
  const movedAll = remapRows(
    { sessions: u.state.sessions, redos: u.state.redos, rungUses: u.state.rungUses, checkAttempts: u.state.checkAttempts, code: u.state.code,
      grades: u.state.grades, bankItems: u.state.bankItems, designSessions: u.state.designSessions, events: u.state.events, aiLog: u.state.aiLog, pictures: u.state.pictures },
    idMapOfPairs(rec.renames),
  )
  const moved = movedAll.rows
  const codeMerged = u.report.collisions.code + movedAll.collisions.code
  // canonical row order (by id): reconcile appends vanished and inserted rows, so without this a second run would reorder the array
  const tickets = [...rec.puts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  let rewritten = 0
  const designSessions = moved.designSessions.map((s): DesignSession => {
    const next = rewriteLegacyMode(s) // null = nothing to rewrite
    if (!next) return s
    rewritten++
    return next
  })

  // MIG-20: only the old default 1440, or a missing/unusable value, is replaced; any other stored value is kept
  const stored = state.settings.coreMinutes
  const coreBefore = typeof stored === 'number' && Number.isFinite(stored) && stored >= MIN_CORE_MINUTES ? stored : OLD_DEFAULT_CORE_MINUTES
  const coreAfter = coreBefore === OLD_DEFAULT_CORE_MINUTES ? 2 * weeklyTotal(budgetsOf(state.settings, plan.mix)) : coreBefore
  let settings = { ...state.settings, planVersion: planVersionOf(plan), possibleXp: possibleXp(tickets) }
  if (migrating) settings = { ...settings, modelVersion: 2, flatMigratedAt: opts.now, coreMinutes: coreAfter }

  const next: FlatState = { ...u.state, ...moved, designSessions, tickets, settings }
  assertFlat(state, next, planIds, codeMerged, new Set(rec.renames.map(r => r.to)))

  const emit = (migrating && state.tickets.length > 0) || u.report.containers > 0
  if (!emit) return { next, newEvents: [], report: null }
  const dropped = new Set([...u.folded.keys(), ...rec.renames.map(r => r.from)])
  const report: ReplanReport = {
    backupFile: opts.backupFile,
    archived: tickets.filter(t => t.archived && !beforeById.get(t.id)?.archived).length,
    doneAndDropped: state.tickets
      .filter(t => t.status === 'done' && !isOffPlanOrigin(t.origin) && !planIds.has(t.id) && !dropped.has(t.id))
      .map(t => t.id).sort(),
    xpBefore,
    xpAfter: totalXp(tickets),
    designSessionsRewritten: rewritten,
    coreMinutesBefore: coreBefore,
    coreMinutesAfter: migrating ? coreAfter : coreBefore,
    codeMerged,
  }
  return { next, newEvents: [{ t: 'replan', at: opts.now, report }], report }
}

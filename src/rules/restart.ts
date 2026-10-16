import type { JournalRow, Session, Ticket } from '../data/types'
import { localDayKey, localDaysBetween, parseLocalDate } from '../lib/dates'

/** W5 (rituals.md): a run of this many inactive days ends in a welcome (Floor first) and a half-load window. */
export const RESTART_INACTIVE_DAYS = 4
/** The half-load window: this many local days after the return day. */
export const HALF_LOAD_DAYS = 4

export interface RestartState { welcome: boolean; halfLoad: boolean }
export type Lead = 'restart' | 'short' | null

/** Local days (`YYYY-MM-DD`) with a session row, a non-archived ticket moved to Done, or a studied Journal row (rituals.md "Active day"). */
export function activeDaysOf(a: { tickets: readonly Ticket[]; sessions: readonly Session[]; journal: readonly JournalRow[] }): Set<string> {
  const out = new Set<string>()
  for (const s of a.sessions) out.add(localDayKey(s.start))
  for (const t of a.tickets) if (t.status === 'done' && !t.archived && t.doneAt !== undefined) out.add(localDayKey(t.doneAt))
  for (const j of a.journal) if (j.mode === 'studied') out.add(j.day)
  return out
}

/** Whole local days strictly between two day keys. */
const between = (a: string, b: string): number => localDaysBetween(parseLocalDate(a), parseLocalDate(b)) - 1

/**
 * Pure. `inactive` = the days strictly between the latest active day before today and today.
 * welcome: inactive >= 4 and today is not yet active. halfLoad: today is 1 to 4 days after the latest active day that ended a run of
 * 4 or more inactive days (the return day itself is a normal day). Nothing is stored; no missed-day count exists.
 */
export function restartState(active: ReadonlySet<string>, today: string): RestartState {
  const days = [...active].filter(d => d <= today).sort()
  const last = days.filter(d => d < today).pop()
  if (last === undefined) return { welcome: false, halfLoad: false }
  const welcome = !active.has(today) && between(last, today) >= RESTART_INACTIVE_DAYS
  let back: string | undefined
  for (let i = days.length - 1; i > 0 && back === undefined; i--) if (between(days[i - 1], days[i]) >= RESTART_INACTIVE_DAYS) back = days[i]
  const since = back === undefined ? 0 : localDaysBetween(parseLocalDate(back), parseLocalDate(today))
  return { welcome, halfLoad: since >= 1 && since <= HALF_LOAD_DAYS }
}

/**
 * Which lead the Floor card takes on Today: a restart day wins over a short day. A started ticket (the resume quest) ends a short lead;
 * on a restart day the lead stays (RIT-54) and the quest shows below the Floor card, which then has no accent.
 */
export const leadOf = (r: RestartState, mixFloor: boolean, resuming: boolean): Lead => (r.welcome ? 'restart' : resuming ? null : mixFloor ? 'short' : null)

/** Half of a day's minutes, rounded down to a multiple of 5. */
export const halfBudget = (min: number): number => Math.floor(min / 10) * 5
export const dayBudgets = (budgets: readonly number[], r: RestartState): number[] => (r.halfLoad ? budgets.map(halfBudget) : [...budgets])

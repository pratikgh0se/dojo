import type { Ticket } from '../data/types'
import { localDaysBetween, parseLocalDate, weekdayOf, type Weekday } from '../lib/dates'

export const SPRINT_DAYS = 14
export const TOTAL_SPRINTS = 72

export type PlanPosition =
  | { phase: 'before'; daysUntil: number }
  | { phase: 'active'; sprint: number; dayInSprint: number; weekday: Weekday }
  | { phase: 'after'; daysSinceEnd: number }

function dayIndex(ms: number, startDate: string): number {
  return localDaysBetween(parseLocalDate(startDate), ms)
}

// The plan's nominal length is 72 sprints, but a ticket can end up parked beyond that
// (slid or shifted past S72 and never finished). Callers pass this in as `totalSprints`
// so "after" doesn't kick in while there's still live work sitting past S72.
export function planPosition(nowMs: number, startDate: string, totalSprints: number = TOTAL_SPRINTS): PlanPosition {
  const i = dayIndex(nowMs, startDate)
  if (i < 0) return { phase: 'before', daysUntil: -i }
  const last = SPRINT_DAYS * totalSprints
  if (i >= last) return { phase: 'after', daysSinceEnd: i - last }
  return {
    phase: 'active',
    sprint: Math.floor(i / SPRINT_DAYS) + 1,
    dayInSprint: (i % SPRINT_DAYS) + 1,
    weekday: weekdayOf(nowMs),
  }
}

export function sprintOf(ms: number, startDate: string): number {
  return Math.floor(dayIndex(ms, startDate) / SPRINT_DAYS) + 1
}

export function currentSprint(nowMs: number, startDate: string, totalSprints: number = TOTAL_SPRINTS): number {
  return Math.min(totalSprints, Math.max(1, sprintOf(nowMs, startDate)))
}

// The effective last sprint for plan-position purposes: 72, or the highest sprint of
// any live (non-archived, unfinished) ticket, whichever is greater. Pure — callers pass
// the tickets in; rules never touch Dexie.
export function effectiveLastSprint(tickets: Ticket[], base: number = TOTAL_SPRINTS): number {
  return tickets.reduce((m, t) => (!t.archived && t.status !== 'done' ? Math.max(m, t.sprint) : m), base)
}

/**
 * The sprint number content views compare against: 0 before the start date,
 * the active sprint inside the window, lastSprint + 1 after it.
 */
export function viewSprint(nowMs: number, startDate: string, lastSprint: number = TOTAL_SPRINTS): number {
  const pos = planPosition(nowMs, startDate, lastSprint)
  if (pos.phase === 'before') return 0
  if (pos.phase === 'after') return lastSprint + 1
  return pos.sprint
}

import type { Ticket } from '../data/types'
import { addLocalDays, localDayKey, localDaysBetween, parseLocalDate, weekdayOf, type Weekday } from '../lib/dates'

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

// How many live tickets are still unfinished — used to flag the "after/finished" state
// when the plan is nominally done but work remains.
export function unfinishedCount(tickets: Ticket[]): number {
  return tickets.filter(t => !t.archived && t.status !== 'done').length
}

/**
 * The sprint a card counts under in the Today, Load-check and health views. Roll-over moves a card to the
 * current sprint (`sprint`) but it stays a card left behind from where it started (`carry.home`) until it is
 * finished or moved on by hand, so those views read the same as before roll-over existed.
 */
export function effSprint(t: Pick<Ticket, 'sprint' | 'carry'>): number {
  return t.carry && t.sprint === t.carry.into ? t.carry.home : t.sprint
}

export function sprintStart(sprint: number, startDate: string): number {
  return addLocalDays(parseLocalDate(startDate), (sprint - 1) * SPRINT_DAYS)
}

export function attributeSession(startMs: number, startDate: string): { dayKey: string; sprint: number } {
  return { dayKey: localDayKey(startMs), sprint: sprintOf(startMs, startDate) }
}

export const SPRINTS_PER_BLOCK = 4
export const TOTAL_BLOCKS = TOTAL_SPRINTS / SPRINTS_PER_BLOCK

export function blockOf(sprint: number): number {
  return Math.ceil(sprint / SPRINTS_PER_BLOCK)
}

export function blockSprints(block: number): [number, number] {
  return [(block - 1) * SPRINTS_PER_BLOCK + 1, block * SPRINTS_PER_BLOCK]
}

/** "S{from}" when the range is a single sprint, else "S{from}–S{to}". Shared by every
 * screen that shows a sprint span (Map's sprint path, the AI stage ladder/detail). */
export function sprintRangeLabel(from: number, to: number): string {
  return from === to ? `S${from}` : `S${from}–S${to}`
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

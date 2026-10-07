// Workload (briefs spec §3): minutes, the sprint budget, day types, suggestions, roll-over and
// rebalancing. Pure: rules never touch Dexie.
import type { DayType } from '../ai/types'
import type { DojoEvent, Ticket } from '../data/types'
import { localDayKey, weekdayOf, type Weekday } from '../lib/dates'
import { isContainer, minutesOf } from './brief'
import { focusMinutesToday } from './focus'
import { effSprint, planPosition, sprintOf, TOTAL_SPRINTS } from './sprint'

export const DEFAULT_CORE_MINUTES = 1440
export const MIN_CORE_MINUTES = 30
export const MAX_CORE_MINUTES = 20160

export function coreMinutesOf(s: { coreMinutes?: number } | undefined): number {
  const v = s?.coreMinutes
  return typeof v === 'number' && Number.isFinite(v) && v >= MIN_CORE_MINUTES ? v : DEFAULT_CORE_MINUTES
}

/** Mon-Wed focus, Thu-Fri light, Sat-Sun long (spec §1 brief.dayType). */
export function dayTypeOf(day: Weekday): DayType {
  return day === 'Thu' || day === 'Fri' ? 'light' : day === 'Sat' || day === 'Sun' ? 'long' : 'focus'
}
/** How many minutes a day of each type can hold when suggesting cards. */
export const DAY_MINUTES: Record<DayType, number> = { focus: 120, light: 60, long: 240 }
export const MAX_SUGGESTED = 5

/** A card without a brief counts as focus work. */
export const cardDayType = (t: Pick<Ticket, 'brief'>): DayType => t.brief?.dayType ?? 'focus'

const live = (t: Ticket) => !t.archived && !isContainer(t)
const open = (t: Ticket) => live(t) && t.status !== 'done'

/** Minutes still to do in a sprint: its unfinished cards (a split card counts through its sessions). */
export function plannedMinutes(tickets: readonly Ticket[], sprint: number): number {
  return tickets.filter(t => open(t) && t.sprint === sprint).reduce((a, t) => a + minutesOf(t), 0)
}

/** "18", "1.5": one decimal only when the value is not whole. */
export function hoursText(minutes: number): string {
  const h = Math.round((minutes / 60) * 10) / 10
  return Number.isInteger(h) ? String(h) : h.toFixed(1)
}
export const loadMinutesText = (planned: number, budget: number): string => `${hoursText(planned)} h / ${hoursText(budget)} h`
/** "Sprint 2: 30 h planned, budget 24 h." - the Board follows it with the "Rebalance?" button. */
export const overBudgetText = (sprint: number, planned: number, budget: number): string =>
  `Sprint ${sprint}: ${hoursText(planned)} h planned, budget ${hoursText(budget)} h.`

export const isOverBudget = (planned: number, budget: number): boolean => planned > budget

export interface Suggestion { ticket: Ticket; minutes: number }

/**
 * Today's suggestions (spec §3): cards of the sprint that fit today's day type and the time left.
 * Cards of today's type come first-and-only when any exist, otherwise any card; plan order; the first
 * that fits, then the next that still fits. At least one card is always offered while time is left.
 */
export function suggestCards(tickets: readonly Ticket[], sprint: number, nowMs: number, minutesDoneToday = 0): Suggestion[] {
  const type = dayTypeOf(weekdayOf(nowMs))
  const left = DAY_MINUTES[type] - minutesDoneToday
  if (left <= 0) return []
  const pool = tickets.filter(t => open(t) && t.sprint === sprint).sort((a, b) => a.order - b.order)
  const ofType = pool.filter(t => cardDayType(t) === type)
  const cands = ofType.length > 0 ? ofType : pool
  const out: Suggestion[] = []
  let used = 0
  for (const t of cands) {
    const m = minutesOf(t)
    if (out.length > 0 && used + m > left) continue
    out.push({ ticket: t, minutes: m })
    used += m
    if (out.length >= MAX_SUGGESTED) break
  }
  return out
}

/** Minutes of the cards finished on the local day of `nowMs` (what today has already used). */
export function minutesDoneOn(tickets: readonly Ticket[], nowMs: number): number {
  const day = localDayKey(nowMs)
  return tickets.filter(t => live(t) && t.status === 'done' && t.doneAt !== undefined && localDayKey(t.doneAt) === day)
    .reduce((a, t) => a + minutesOf(t), 0)
}

/**
 * Time used today (G4 M3): a finished card's minutes count only when it had no focus event today;
 * the focus minutes of today are then added, so a card worked in a session is never counted twice.
 */
export function minutesUsedToday(tickets: readonly Ticket[], events: readonly DojoEvent[], nowMs: number): number {
  const day = localDayKey(nowMs)
  const focused = new Set(events.flatMap(e => (e.t === 'focus' && Number.isFinite(e.minutes) && e.minutes > 0 && localDayKey(e.at) === day ? [e.id] : [])))
  return minutesDoneOn(tickets.filter(t => !focused.has(t.id)), nowMs) + focusMinutesToday(events, nowMs)
}

// ---- roll-over ----

export interface Rollover { id: string; from: number; to: number; rolledFrom: number[]; home: number }

/**
 * When a sprint has ended by date, every unfinished card in it moves on to the sprint that is now
 * current (spec §3). The card keeps its identity and gains the sprints it rolled over; nothing else
 * (XP, slidFrom) changes. Nothing rolls before the plan starts or after it ends, and sprints that had already
 * ended when tracking began (`trackedFrom`) never roll: their cards stay left behind, as before roll-over existed.
 */
export function rolloverPlan(tickets: readonly Ticket[], nowMs: number, startDate: string, trackedFrom = 1): Rollover[] {
  if (!startDate) return []
  const pos = planPosition(nowMs, startDate)
  if (pos.phase !== 'active') return []
  const current = sprintOf(nowMs, startDate)
  return tickets
    // a split container rolls with its sessions, so it is not `open()` (which skips containers)
    .filter(t => !t.archived && t.status !== 'done' && t.sprint < current && t.sprint >= trackedFrom)
    .map(t => ({ id: t.id, from: t.sprint, to: current, home: effSprint(t), rolledFrom: [...(t.rolledFrom ?? []), t.sprint] }))
}

export function applyRollover(t: Ticket, r: Rollover): Ticket {
  return { ...t, sprint: r.to, rolledFrom: r.rolledFrom, carry: { home: r.home, into: r.to } }
}

export interface RolledGroup { from: number; count: number }
/** "N cards rolled from Sprint X": unfinished cards now in `sprint` grouped by the sprint they last rolled from. */
export function rolledNotes(tickets: readonly Ticket[], sprint: number): RolledGroup[] {
  const by = new Map<number, number>()
  for (const t of tickets) {
    const from = t.rolledFrom?.[t.rolledFrom.length - 1]
    if (open(t) && t.sprint === sprint && from !== undefined) by.set(from, (by.get(from) ?? 0) + 1)
  }
  return [...by].map(([from, count]) => ({ from, count })).sort((a, b) => a.from - b.from)
}
/**
 * shell-today-board A9 / ruling 9 Q6: at most one aggregated line, for the most recent roll-over — every open
 * card that rolled into `sprint`, "from Sprint <sprint − 1>"; null when none did.
 */
export function rolledNote(tickets: readonly Ticket[], sprint: number): RolledGroup | null {
  const count = rolledNotes(tickets, sprint).reduce((a, g) => a + g.count, 0)
  return count > 0 ? { from: sprint - 1, count } : null
}
export const rolledText = (g: RolledGroup): string => `${g.count} ${g.count === 1 ? 'card' : 'cards'} rolled from Sprint ${g.from}`

/** How many times a card has rolled over (the review's "slipped" measure). */
export const rollCount = (t: Pick<Ticket, 'rolledFrom'>): number => t.rolledFrom?.length ?? 0

// ---- rebalancing ----

export interface RebalanceProposal {
  sprint: number
  to: number
  planned: number
  budget: number
  moves: { id: string; title: string; minutes: number }[]
  /** planned minutes left in the sprint if every move is accepted */
  after: number
}

/**
 * The latest-ordered, non-pinned, not-started cards of an over-budget sprint move to the next sprint
 * until it fits (Addendum 1 Q12: the target is always the next sprint). Pinned and Doing cards stay.
 */
export function rebalanceProposal(tickets: readonly Ticket[], sprint: number, budget: number): RebalanceProposal {
  const planned = plannedMinutes(tickets, sprint)
  // nothing moves past the last sprint of the plan
  const movable = sprint >= TOTAL_SPRINTS ? [] : tickets
    .filter(t => open(t) && t.sprint === sprint && !t.pinned && t.status !== 'doing')
    .sort((a, b) => b.order - a.order)
  const moves: RebalanceProposal['moves'] = []
  let left = planned
  for (const t of movable) {
    if (left <= budget) break
    const minutes = minutesOf(t)
    moves.push({ id: t.id, title: t.title, minutes })
    left -= minutes
  }
  return { sprint, to: sprint + 1, planned, budget, moves, after: left }
}

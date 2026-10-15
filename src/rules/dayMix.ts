import type { Lane, Ticket } from '../data/types'
import type { PlanPhase as PlanPhaseV2 } from '../data/planV2'
import { laneOf, mixLanes } from './lanes'

export const FLOOR_BELOW_MIN = 20
export const SECOND_TICKET_MIN = 30

export function effectiveOrder(t: Ticket): number {
  return t.orderOverride ?? t.order ?? Number.MAX_SAFE_INTEGER
}

export function budgetFor(date: Date, budgets: number[]): number {
  return budgets[date.getDay()] ?? 0
}

export interface DayMix { budget: number; items: Ticket[]; floor: boolean; waitsForLongerDay: Ticket[]; lanesDone: Lane[] }

export const byOrder = (a: Ticket, b: Ticket): number => effectiveOrder(a) - effectiveOrder(b) || a.id.localeCompare(b.id)
/** README "Open ticket": not archived and not done, so it includes doing, blocked and need-help tickets. */
export const isOpen = (t: Ticket): boolean => !t.archived && t.status !== 'done'
/** README "Queued ticket": open and waiting its turn (`todo`). Doing, blocked and need-help tickets are open but not queued; a legacy `slid` counts as todo. */
export const isQueued = (t: Ticket): boolean => isOpen(t) && t.status !== 'doing' && t.status !== 'blocked' && t.status !== 'help'
/** A ticket the learner parked on the Board (board.md): open, and neither queued nor started. */
export const isParked = (t: Ticket): boolean => !t.archived && (t.status === 'blocked' || t.status === 'help')

/** Queued tickets of each mix lane in effective order (a blocked or need-help ticket never heads its lane, TODAY-09). */
function openByLane(tickets: Ticket[], lanes: Lane[]): Map<Lane, Ticket[]> {
  const out = new Map<Lane, Ticket[]>(lanes.map(l => [l, []]))
  for (const t of tickets) {
    if (!isQueued(t)) continue
    out.get(laneOf(t))?.push(t)
  }
  for (const list of out.values()) list.sort(byOrder)
  return out
}

/** Started tickets of the mix lanes (the bank lane is done-only; Career only while `careerLane` is on, TODAY-09), lowest effective order first. */
export function doingTickets(tickets: Ticket[], careerLane: boolean): Ticket[] {
  return tickets
    .filter(t => isOpen(t) && t.status === 'doing' && laneOf(t) !== 'bank' && (careerLane || laneOf(t) !== 'career'))
    .sort(byOrder)
}

/** Spec 3.2, "Today (dailyMix)". Pure; the weekday is only a budget. */
export function dailyMix(a: { tickets: Ticket[]; date: Date; budgets: number[]; careerLane: boolean }): DayMix {
  const budget = budgetFor(a.date, a.budgets)
  const lanes = mixLanes(a.careerLane)
  const open = openByLane(a.tickets, lanes)
  const doing = doingTickets(a.tickets, a.careerLane)
  const allOpenCount = (l: Lane): number =>
    (open.get(l)?.length ?? 0) + doing.filter(t => laneOf(t) === l).length + a.tickets.filter(t => isParked(t) && laneOf(t) === l).length
  const lanesDone = lanes.filter(l => allOpenCount(l) === 0)

  const items: Ticket[] = [...doing]
  let used = doing.reduce((s, t) => s + t.estMin, 0)
  const represented = new Set(doing.map(laneOf))
  const heads = lanes
    .filter(l => !represented.has(l))
    .flatMap(l => { const h = open.get(l)?.[0]; return h ? [h] : [] })
    .sort(byOrder)
  const tooLong = (t: Ticket): boolean => t.estMin > 2 * budget
  // every first-open ticket that is too long for today's budget (TODAY-11, TODAY-14 name them all)
  const waitsForLongerDay = heads.filter(tooLong)

  if (budget >= FLOOR_BELOW_MIN) {
    if (items.length === 0 && heads.length > 0) {
      const head = heads[0]
      if (!tooLong(head)) {
        items.push(head)
        used += head.estMin
      } else {
        const fit = heads
          .filter(t => t.estMin <= budget)
          .sort((x, y) => x.estMin - y.estMin || byOrder(x, y))[0]
        if (fit) { items.push(fit); used += fit.estMin }
      }
    }
    for (const t of heads) {
      if (items.includes(t) || tooLong(t)) continue
      if (used + t.estMin <= budget) { items.push(t); used += t.estMin }
    }
    const remaining = budget - used
    if (items.length > 0 && remaining >= SECOND_TICKET_MIN) {
      const pool = lanes.flatMap(l => open.get(l) ?? []).filter(t => !items.includes(t) && t.estMin <= remaining).sort(byOrder)
      if (pool[0]) items.push(pool[0])
    }
  }

  const anyHead = heads.length > 0
  const floor = items.length === 0 && anyHead
  return { budget, items, floor, waitsForLongerDay, lanesDone }
}

export type NextAction =
  | { kind: 'resume'; ticket: Ticket; reason: string }
  | { kind: 'review'; count: number; reason: string }
  | { kind: 'start'; ticket: Ticket; reason: string }
  | { kind: 'wait'; ticket: Ticket | null; reason: string }

export const DEFAULT_REVIEW_THRESHOLD = 10
export const PARKED_REASON = 'the rest is blocked or needs help'

/** "Phase 2 tickets are being written" while the path lane is empty and a phase is not authored yet; else null. */
export function pathWaitNote(tickets: Ticket[], phases: PlanPhaseV2[]): string | null {
  const pathOpen = tickets.some(t => isOpen(t) && laneOf(t) === 'path')
  if (pathOpen) return null
  const next = [...phases].filter(p => !p.authored).sort((x, y) => x.p - y.p)[0]
  return next ? `Phase ${next.p} tickets are being written` : null
}

/** Spec 3.2, "Next action". The reason is one lowercase line (the Today card prints it as is). */
export function nextAction(a: {
  tickets: Ticket[]; date: Date; budgets: number[]; careerLane: boolean; dueReviews: number
  reviewThreshold?: number; phases: PlanPhaseV2[]
}): NextAction {
  const started = doingTickets(a.tickets, a.careerLane)[0]
  if (started) return { kind: 'resume', ticket: started, reason: 'you started this' }
  const threshold = a.reviewThreshold ?? DEFAULT_REVIEW_THRESHOLD
  if (a.dueReviews > threshold) return { kind: 'review', count: a.dueReviews, reason: `${a.dueReviews} reviews are due` }
  const mix = dailyMix(a)
  const first = mix.items[0]
  if (first) return { kind: 'start', ticket: first, reason: `next in your queue, about ${first.estMin} min` }

  if (a.dueReviews > 0) return { kind: 'review', count: a.dueReviews, reason: 'nothing fits today, so reviews first' }
  const lanes = mixLanes(a.careerLane)
  const heads = lanes
    .flatMap(l => { const h = a.tickets.filter(t => isQueued(t) && laneOf(t) === l).sort(byOrder)[0]; return h ? [h] : [] })
    .sort((x, y) => x.estMin - y.estMin || byOrder(x, y))
  if (heads[0]) return { kind: 'start', ticket: heads[0], reason: `a short day: the shortest ticket in your queue, about ${heads[0].estMin} min` }
  // TODAY-21: nothing is queued; if the open tickets that remain are parked on the Board, say so instead of "done"
  if (a.tickets.some(t => isParked(t) && lanes.includes(laneOf(t)))) return { kind: 'wait', ticket: null, reason: PARKED_REASON }
  return { kind: 'wait', ticket: null, reason: pathWaitNote(a.tickets, a.phases) ?? 'every ticket in your queue is done' }
}

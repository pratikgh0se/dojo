import type { Lane, Ticket } from '../data/types'
import type { PlanPhase as PlanPhaseV2 } from '../data/planV2'
import { byOrder, effectiveOrder, isOpen, isParked, isQueued, pathWaitNote } from './dayMix'
import { laneOf, mixLanes } from './lanes'

export const DOING_SOFT_CAP = 3
export const UP_NEXT_PER_LANE = 10

export type LaneFilter = 'all' | Lane
export interface LaneQueue { lane: Lane; items: Ticket[]; more: number; total: number }
export interface QueueView { doing: Ticket[]; doingCount: number; doingOverCap: boolean; /** blocked and need-help tickets (PATH-32), lane blocks in the day-mix order */ blocked: Ticket[]; upNext: LaneQueue[]; moreTotal: number; done: Ticket[] }

const byDoneDesc = (a: Ticket, b: Ticket): number => (b.doneAt ?? 0) - (a.doneAt ?? 0) || a.id.localeCompare(b.id)

export function matchesSearch(t: Ticket, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return t.title.toLowerCase().includes(q)
}

/** The lane a ticket is shown under (README "Lane tag", PATH-06): `bank` counts as DSA, so a done bank row renders data-lane="dsa". */
export const tagLane = (t: Ticket): Lane => { const l = laneOf(t); return l === 'bank' ? 'dsa' : l }

function laneQueue(live: Ticket[], lane: Lane, search: string, perLane: number): LaneQueue {
  const rest = live.filter(t => isQueued(t) && laneOf(t) === lane && matchesSearch(t, search)).sort(byOrder)
  return { lane, items: rest.slice(0, perLane), more: Math.max(0, rest.length - perLane), total: rest.length }
}

export function queueView(a: { tickets: Ticket[]; careerLane: boolean; lane?: LaneFilter; search?: string; perLane?: number }): QueueView {
  const filter = a.lane ?? 'all'
  const perLane = a.perLane ?? UP_NEXT_PER_LANE
  const search = a.search ?? ''
  const live = a.tickets.filter(t => !t.archived)
  // README "Lane tag": a bank ticket is shown as DSA. PATH-07: with the career lane off, Career tickets are in no group.
  const shown = (t: Ticket): boolean => a.careerLane || laneOf(t) !== 'career'
  const inFilter = (t: Ticket): boolean => shown(t) && (filter === 'all' || tagLane(t) === filter)
  const started = live.filter(t => t.status === 'doing' && shown(t))
  const lanes = mixLanes(a.careerLane).filter(l => filter === 'all' || l === filter)
  const upNext = lanes.map(l => laneQueue(live, l, search, perLane))
  // PATH-32: lane blocks as in PATH-03 under chip All, effective order inside each block
  const laneRank = (t: Ticket): number => { const i = mixLanes(a.careerLane).indexOf(laneOf(t)); return i < 0 ? 99 : i }
  const parked = live.filter(t => isParked(t) && inFilter(t) && matchesSearch(t, search)).sort((x, y) => laneRank(x) - laneRank(y) || byOrder(x, y))
  return {
    doing: started.filter(t => inFilter(t) && matchesSearch(t, search)).sort(byOrder),
    blocked: parked,
    doingCount: started.length,
    doingOverCap: started.length > DOING_SOFT_CAP,
    upNext,
    moreTotal: upNext.reduce((s, l) => s + l.more, 0),
    done: live.filter(t => t.status === 'done' && inFilter(t) && matchesSearch(t, search)).sort(byDoneDesc),
  }
}

export interface LaneChip { lane: LaneFilter; open: number; done: boolean }

export function laneChips(a: { tickets: Ticket[]; careerLane: boolean; phases: PlanPhaseV2[] }): LaneChip[] {
  const lanes = mixLanes(a.careerLane)
  const wait = pathWaitNote(a.tickets, a.phases) !== null
  const chips = lanes.map((l): LaneChip => {
    const n = a.tickets.filter(t => isOpen(t) && laneOf(t) === l).length
    return { lane: l, open: n, done: n === 0 && !(l === 'path' && wait) }
  })
  const total = chips.reduce((s, c) => s + c.open, 0)
  return [{ lane: 'all', open: total, done: total === 0 && !wait }, ...chips]
}

/** The Today "Pick something else" list: the other started tickets, then the next ten open tickets per lane. The quest ticket is in neither (TODAY-16). */
export function todayPickList(a: { tickets: Ticket[]; careerLane: boolean; excludeId?: string; perLane?: number }): { doing: Ticket[]; lanes: LaneQueue[] } {
  const v = queueView({ tickets: a.excludeId === undefined ? a.tickets : a.tickets.filter(t => t.id !== a.excludeId), careerLane: a.careerLane, perLane: a.perLane ?? UP_NEXT_PER_LANE })
  return { doing: v.doing, lanes: v.upNext }
}

export interface OrderPatch { id: string; orderOverride: number }

/**
 * Where a dragged ticket lands inside its own lane. `toIndex` counts the lane's open, not-started tickets with the
 * ticket itself taken out (0 = first). Only a queued (`todo`) ticket moves; a blocked or need-help ticket keeps its place. Returns the `orderOverride` patches: one value between the new neighbours,
 * or, when floats leave no room, a renumbering of the lane. Never crosses lanes (PATH-21).
 */
export function moveInLane(tickets: Ticket[], id: string, toIndex: number): OrderPatch[] {
  const moved = tickets.find(t => t.id === id)
  if (!moved || !isQueued(moved)) return []
  const lane = laneOf(moved)
  const others = tickets.filter(t => t.id !== id && isQueued(t) && laneOf(t) === lane).sort(byOrder)
  if (others.length === 0) return []
  const at = Math.max(0, Math.min(others.length, Math.trunc(toIndex)))
  if ([...others, moved].sort(byOrder).indexOf(moved) === at) return []
  const prev = others[at - 1]
  const next = others[at]
  const lo = prev ? effectiveOrder(prev) : null
  const hi = next ? effectiveOrder(next) : null
  const mid = lo !== null && hi !== null ? (lo + hi) / 2 : lo !== null ? lo + 1 : (hi as number) - 1
  if ((lo === null || mid > lo) && (hi === null || mid < hi)) return [{ id, orderOverride: mid }]
  const base = effectiveOrder(others[0])
  return [...others.slice(0, at), moved, ...others.slice(at)].map((t, i) => ({ id: t.id, orderOverride: base + i }))
}

import type { PlanNode, PlanPhase as PlanPhaseV2 } from '../data/planV2'
import type { Ticket } from '../data/types'
import { addLocalDays, startOfLocalDay } from '../lib/dates'
import { laneOf, mixLanes } from './lanes'
import { weeklyTotal } from './prefs'

/** Rituals and slips on top of the authored minutes. The spec gives no factor; 1.1 reproduces "February to March 2028" on day one. */
export const PACE_SLACK = 1.1
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export interface Projection { remainingMin: number; unwrittenMin: number; weeklyMin: number; weeks: number | null; endMs: number | null; label: string | null }

export function remainingMinutes(tickets: Ticket[], careerLane: boolean): number {
  const lanes = new Set(mixLanes(careerLane))
  return tickets.filter(t => !t.archived && t.status !== 'done' && lanes.has(laneOf(t))).reduce((s, t) => s + t.estMin, 0)
}

/** Planned hours of the topic and build nodes of phases whose tickets are not written yet (bands are rituals). */
export function unwrittenMinutes(nodes: PlanNode[], phases: PlanPhaseV2[]): number {
  const open = new Set(phases.filter(p => !p.authored).map(p => p.p))
  return nodes.filter(n => open.has(n.phase) && n.kind !== 'band').reduce((s, n) => s + Math.round((n.hours ?? 0) * 60), 0)
}

export function projectedEnd(a: { tickets: Ticket[]; nodes?: PlanNode[]; phases?: PlanPhaseV2[]; budgets: number[]; careerLane: boolean; now: number }): Projection {
  const unwrittenMin = unwrittenMinutes(a.nodes ?? [], a.phases ?? [])
  const remainingMin = remainingMinutes(a.tickets, a.careerLane) + unwrittenMin
  const weeklyMin = weeklyTotal(a.budgets)
  if (weeklyMin <= 0 || remainingMin <= 0) return { remainingMin, unwrittenMin, weeklyMin, weeks: null, endMs: null, label: null }
  const weeks = (remainingMin * PACE_SLACK) / weeklyMin
  const endMs = addLocalDays(startOfLocalDay(a.now), Math.ceil(weeks * 7))
  const d = new Date(endMs)
  return { remainingMin, unwrittenMin, weeklyMin, weeks, endMs, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
}

/** Lowercase on purpose: the contract matches `at this pace the plan ends about <Month> <Year>` case-sensitively (TODAY-25, SET-02). The UI may capitalise it in the text, never via CSS text-transform. */
export function paceLine(p: Projection): string {
  if (p.weeklyMin <= 0) return 'Set a weekly budget to see when the plan ends'
  if (p.remainingMin <= 0 || p.label === null) return 'Every ticket in the plan is done'
  return `at this pace the plan ends about ${p.label}`
}

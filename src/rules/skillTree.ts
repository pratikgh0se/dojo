import type { PlanNode, PlanV2 } from '../data/planV2'
import type { Ticket } from '../data/types'
import { effectiveOrder } from './dayMix'

export type NodeState = 'locked' | 'available' | 'next' | 'inprog' | 'done'

const live = (t: Ticket): boolean => !t.archived

/** The live (non-archived) tickets of one node, in queue order. */
export function nodeTickets(nodeId: string, tickets: readonly Ticket[]): Ticket[] {
  return tickets.filter(t => live(t) && t.node === nodeId).sort((a, b) => effectiveOrder(a) - effectiveOrder(b) || a.id.localeCompare(b.id))
}

/** A node is done when it has tickets and every one is done. */
export function isNodeDone(nodeId: string, tickets: readonly Ticket[]): boolean {
  const ts = nodeTickets(nodeId, tickets)
  return ts.length > 0 && ts.every(t => t.status === 'done')
}

/**
 * The five states of the skill tree (SKILLS Definitions), first match wins:
 * done, next (the node of the ticket Today recommends, so at most one), inprog, locked, available.
 * `locked` is a soft lock: no tickets yet, or a recommended-first node that is not done. It never blocks Start.
 */
/** The DSA and Design trees have no locked state (trees-and-banks.md): a node of theirs is done, next, inprog or available. */
const isTreeNode = (node: PlanNode): boolean => node.area === 'dsa' || node.area === 'design'

export function nodeState(node: PlanNode, plan: PlanV2, tickets: readonly Ticket[], nextTicketId: string | null): NodeState {
  const ts = nodeTickets(node.id, tickets)
  if (ts.length > 0 && ts.every(t => t.status === 'done')) return 'done'
  if (nextTicketId !== null && ts.some(t => t.id === nextTicketId)) return 'next'
  if (ts.some(t => t.status === 'doing' || t.status === 'done')) return 'inprog'
  if (isTreeNode(node)) return 'available'
  if (ts.length === 0) return 'locked'
  const unmet = node.pre.some(id => plan.nodes.some(n => n.id === id) && !isNodeDone(id, tickets))
  return unmet ? 'locked' : 'available'
}

/**
 * Minutes done and minutes in all over the live tickets whose `area` is this area, each weighted by `estMin`
 * (SKILLS-03). A ticket without an `area` is not counted: the data API oracle reads `ticket.area` only.
 */
export function areaProgress(areaId: string, plan: PlanV2, tickets: readonly Ticket[]): { done: number; total: number } {
  void plan
  let done = 0
  let total = 0
  for (const t of tickets) {
    if (!live(t) || t.area !== areaId) continue
    total += t.estMin
    if (t.status === 'done') done += t.estMin
  }
  return { done, total }
}

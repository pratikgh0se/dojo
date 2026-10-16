// Topic states of an AI node (R2 W3, labs.md Definitions): computed from tickets, checkAttempts, labRuns, labReviews and the lab definitions.
// Nothing is stored. Pure: no React, no Dexie.
import type { CheckAttemptRow, LabReviewRow, LabRunRow, Ticket } from '../data/types'
import { isProven, milestonePassed, type LabMilestone } from './lab'
import { nodeTickets } from './skillTree'
import { nextTicketOf } from './skillView'

export type TopicState = 'learning' | 'learned' | 'built' | 'proven'
export const TOPIC_WORD: Record<TopicState, string> = { learning: 'Learning', learned: 'Learned', built: 'Built', proven: 'Proven' }

/** The part of a lab definition (`GET /labs/info`) the rules need. A `LabInfo` is assignable to it. */
export interface LabDef { closingTicket: string; milestones: readonly LabMilestone[] }
/** The definitions the server knows, by lab id. A lab missing here is unknown to the server. */
export type LabDefs = Readonly<Record<string, LabDef>>

const isLearn = (t: Ticket): boolean => t.kind === 'watch' || t.kind === 'read'
const started = (t: Ticket): boolean => t.status === 'done' || t.status === 'doing'
const isLabBuild = (t: Ticket): boolean => t.kind === 'build' && !!t.lab

/** The newest check attempt of the ticket (by `at`) passed. */
function explainPassed(ticketId: string, attempts: readonly CheckAttemptRow[]): boolean {
  let best: CheckAttemptRow | undefined
  for (const a of attempts) if (a.ticketId === ticketId && (!best || a.at > best.at)) best = a
  return best?.passed === true
}
const milestoneOf = (t: Ticket, defs: LabDefs) => defs[t.lab!.id]?.milestones.find(m => m.ticket === t.id)
const passedOf = (t: Ticket, runs: readonly LabRunRow[], defs: LabDefs): boolean => {
  const m = milestoneOf(t, defs)
  return !!m && milestonePassed(m, runs.filter(r => r.labId === t.lab!.id))
}
const reviewPassed = (labId: string, reviews: readonly LabReviewRow[]): boolean => isProven(reviews.filter(r => r.labId === labId))

/**
 * null: no ticket of the node is done or doing. learned: it has a watch or read ticket, all are done, and each one with `explain` has a passing
 * newest check. built: a lab-linked build ticket exists, every such milestone is passed, and `learned` holds when the node has watch or read
 * tickets. proven: built and the newest review of every lab it uses passed. learning: anything else that was started. A lab-linked build
 * ticket whose lab (or milestone) the server does not know caps the node at learning.
 */
export function topicState(
  node: { id: string }, tickets: readonly Ticket[], checkAttempts: readonly CheckAttemptRow[],
  labRuns: readonly LabRunRow[], labReviews: readonly LabReviewRow[], labsDefs: LabDefs,
): TopicState | null {
  const ts = nodeTickets(node.id, tickets)
  if (!ts.some(started)) return null
  const learn = ts.filter(isLearn)
  const builds = ts.filter(isLabBuild)
  if (builds.some(t => !milestoneOf(t, labsDefs))) return 'learning'
  const learned = learn.length > 0 && learn.every(t => t.status === 'done' && (!t.explain?.length || explainPassed(t.id, checkAttempts)))
  const built = builds.length > 0 && (learn.length === 0 || learned) && builds.every(t => passedOf(t, labRuns, labsDefs))
  if (built) return [...new Set(builds.map(t => t.lab!.id))].every(id => reviewPassed(id, labReviews)) ? 'proven' : 'built'
  return learned ? 'learned' : 'learning'
}

/** The one line under the topic in the node panel (labs.md Definitions, "Next-step line"), or null when there is none. */
export function nextStepLine(
  node: { id: string }, state: TopicState | null, tickets: readonly Ticket[],
  labRuns: readonly LabRunRow[], labReviews: readonly LabReviewRow[], labsDefs: LabDefs,
): string | null {
  const builds = nodeTickets(node.id, tickets).filter(isLabBuild)
  if (state === 'proven') return 'Proven'
  if (state === 'built') {
    const labId = builds.map(t => t.lab!.id).find(id => !reviewPassed(id, labReviews))
    const closing = labId ? tickets.find(t => t.id === labsDefs[labId]?.closingTicket) : undefined
    return closing ? `Request the review on ${closing.title}` : null
  }
  if (state === 'learned') {
    const open = builds.find(t => !passedOf(t, labRuns, labsDefs))
    if (open) return `Build it: ${open.title}`
  }
  return nextTicketOf(node.id, tickets)?.title ?? null
}

import type { PlanPhase } from '../data/planV2'
import type { Ticket } from '../data/types'
import { localDaysBetween, parseLocalDate } from '../lib/dates'
import { byOrder, isOpen, type DayMix, type NextAction } from './dayMix'
import { laneOf } from './lanes'
import { verbObject } from './ticketMeta'

export interface QuestView {
  tone: 'start' | 'resume' | 'review' | 'wait'
  ticket: Ticket | null
  /** the one accent button, `VERB · OBJECT`; null when nothing can start (the card then has no orange button) */
  button: string | null
  reason: string
  /** what follows the ticket, when the ticket has questions */
  then: string | null
  /** the long tickets that wait for a longer day (the screen builds the sentences so each title sits in a plan-content element) */
  waits: Ticket[]
  /** "Phase 2 tickets are being written" when the AI lane has nothing open (S2's `pathWaitNote`) */
  phaseNote: string | null
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five']

export function thenLine(t: Ticket): string | null {
  const n = t.explain?.length ?? 0
  if (n === 0 || (t.kind !== 'watch' && t.kind !== 'read')) return null
  const q = n === 1 ? 'explain-it-simply question' : 'explain-it-simply questions'
  return `${NUMBER_WORDS[Math.min(n, 5)]} ${q}, about 5 minutes, then Done.`
}

/** The Today quest card from S2's `nextAction`, the day's mix and the phase note. */
export function questView(a: {
  action: NextAction; mix: DayMix; pathNote: string | null
  /** mm:ss left in a running or paused session, and the ticket it belongs to; null when there is none or it is over/away */
  studyLeft: string | null; studyTicketId: string | null
}): QuestView {
  const { action } = a
  const mixWaits = a.mix.waitsForLongerDay
  const phaseNote = a.pathNote
  if (action.kind === 'review') {
    return { tone: 'review', ticket: null, button: 'START · REVIEW', reason: action.reason, then: null, waits: mixWaits, phaseNote }
  }
  // a wait quest has no ticket on the card (TODAY-01: no data-ticket-id), whatever S2's type allows
  if (action.kind === 'wait') return { tone: 'wait', ticket: null, button: null, reason: action.reason, then: null, waits: mixWaits, phaseNote }
  const t = action.ticket
  // when every first-open ticket is too long, S2's short-day branch starts the shortest one; it cannot also be the one that "waits" (TODAY-14/15)
  const waits = mixWaits.filter(w => w.id !== t.id)
  const running = a.studyLeft !== null && a.studyTicketId === t.id
  const button = action.kind === 'resume'
    ? (running ? `RESUME · ${a.studyLeft}` : verbObject('RESUME', t.kind))
    : verbObject('START', t.kind)
  return { tone: action.kind, ticket: t, button, reason: action.reason, then: thenLine(t), waits, phaseNote }
}

/** "Day 12" and "Phase 1 of 6 · Measure before you optimise". The day is a count, never a streak. */
export function todayHeading(a: { nowMs: number; startDate: string; phase: number | undefined; phases: readonly PlanPhase[] }): { day: number | null; phaseLine: string } {
  const started = /^\d{4}-\d{2}-\d{2}$/.test(a.startDate)
  const days = started ? localDaysBetween(parseLocalDate(a.startDate), a.nowMs) : -1
  const p = a.phase === undefined ? undefined : a.phases.find(x => x.p === a.phase)
  return { day: started && days >= 0 ? days + 1 : null, phaseLine: p ? `Phase ${p.p} of ${a.phases.length} · ${p.name}` : '' }
}

/** TODAY-57: the phase of the learner's first open path-lane ticket by effective order, whatever lane the quest is in; undefined when no path ticket is open. */
export function currentPathPhase(tickets: readonly Ticket[]): number | undefined {
  return tickets.filter(t => isOpen(t) && laneOf(t) === 'path').sort(byOrder)[0]?.phase
}

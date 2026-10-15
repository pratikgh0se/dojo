import type { Lane, Session, Ticket } from '../data/types'

export interface Minutes { done: number; total: number }
const live = (t: Ticket) => !t.archived
const sum = (ts: readonly Ticket[]): Minutes => ({
  done: ts.filter(t => t.status === 'done').reduce((a, t) => a + t.estMin, 0),
  total: ts.reduce((a, t) => a + t.estMin, 0),
})

/** Minutes over every non-archived ticket, weighted by `estMin`. */
export const planMinutes = (tickets: readonly Ticket[]): Minutes => sum(tickets.filter(live))

/** README lane tag: `bank` is shown as DSA, so there is no bank row. */
const LANE_ORDER: readonly Lane[] = ['path', 'dsa', 'design', 'career', 'ritual']
const shown = (l: Lane): Lane => (l === 'bank' ? 'dsa' : l)

/** One row per lane; AI, DSA and Design always show, Career and Ritual only when they have tickets. Bank tickets fold into DSA. */
export function laneMinutes(tickets: readonly Ticket[], laneOf: (t: Ticket) => Lane): { lane: Lane; minutes: Minutes }[] {
  const mine = tickets.filter(live)
  return LANE_ORDER
    .filter(l => l === 'path' || l === 'dsa' || l === 'design' || mine.some(t => shown(laneOf(t)) === l))
    .map(lane => ({ lane, minutes: sum(mine.filter(t => shown(laneOf(t)) === lane)) }))
}

export const WINDOW_DAYS = 14
/** Minutes of sessions whose `start` lies in the 14 x 24 h before `nowMs`. */
export function recentMinutes(sessions: readonly Session[], nowMs: number): number {
  const from = nowMs - WINDOW_DAYS * 86_400_000
  return sessions.filter(s => s.start >= from && s.start <= nowMs).reduce((a, s) => a + s.minutes, 0)
}

/** SKILLS-25: "<a> of <b> min in the last 14 days", no full stop, no verdict. */
export const paceText = (recent: number, coreMinutes: number): string => `${recent} of ${coreMinutes} min in the last ${WINDOW_DAYS} days`

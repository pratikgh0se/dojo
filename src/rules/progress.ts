import type { Session, StoredEvent, Ticket } from '../data/types'
import { focusMinutesTotal } from './focus'
import { undoneSeqs } from './slide'
import { localDaysBetween, parseLocalDate } from '../lib/dates'
import { sprintOf, TOTAL_SPRINTS, viewSprint } from './sprint'

export type RingKey = 'all' | 'ai' | 'interview' | 'dsa' | 'designs'
export const RING_KEYS: readonly RingKey[] = ['all', 'ai', 'interview', 'dsa', 'designs']
export const RING_LABELS: Record<RingKey, string> = { all: 'All', ai: 'AI', interview: 'Interview', dsa: 'DSA', designs: 'Designs' }
export type PaceTrack = Exclude<RingKey, 'all'>
export const PACE_TRACKS: readonly PaceTrack[] = ['ai', 'interview', 'dsa', 'designs']

const IN: Record<RingKey, (t: Ticket) => boolean> = {
  all: () => true,
  ai: t => t.track === 'ai',
  interview: t => t.track === 'interview',
  dsa: t => t.kind === 'problem',
  designs: t => t.kind === 'design',
}
/** Plan progress counts only origin 'plan' (DATA "Plan progress counts only origin == 'plan'"). */
const liveOf = (tickets: Ticket[]) => tickets.filter(t => !t.archived && t.origin === 'plan')
const isDone = (t: Ticket) => t.status === 'done'

export function rings(tickets: Ticket[]): Record<RingKey, { done: number; total: number }> {
  const live = liveOf(tickets)
  const out = {} as Record<RingKey, { done: number; total: number }>
  for (const k of RING_KEYS) {
    const mine = live.filter(IN[k])
    out[k] = { done: mine.filter(isDone).length, total: mine.length }
  }
  return out
}

export interface BurnPoint { sprint: number; plan: number; done: number | null }

export function burnUp(tickets: Ticket[], startDate: string, currentSprint: number, lastSprint: number): BurnPoint[] {
  const live = liveOf(tickets)
  const doneSprints = live
    .filter(t => isDone(t) && t.doneAt !== undefined)
    .map(t => Math.max(1, sprintOf(t.doneAt as number, startDate)))
  const out: BurnPoint[] = []
  for (let s = 1; s <= lastSprint; s++) {
    out.push({
      sprint: s,
      plan: live.filter(t => t.plannedSprint <= s).length,
      done: s <= currentSprint ? doneSprints.filter(x => x <= s).length : null,
    })
  }
  return out
}

export type BurnMarkerKind = 'now' | 'slide' | 'shift'

export function burnMarkers(
  events: StoredEvent[], startDate: string, currentSprint: number, lastSprint: number,
): { sprint: number; kind: BurnMarkerKind }[] {
  const out: { sprint: number; kind: BurnMarkerKind }[] = []
  if (currentSprint >= 1 && currentSprint <= lastSprint) out.push({ sprint: currentSprint, kind: 'now' })
  const undone = undoneSeqs(events)
  for (const e of events) {
    if (undone.has(e.seq ?? -1)) continue
    if (e.t === 'slide_sprint') out.push({ sprint: Math.max(1, sprintOf(e.at, startDate)), kind: 'slide' })
    else if (e.t === 'shift_plan') out.push({ sprint: Math.max(1, sprintOf(e.at, startDate)), kind: 'shift' })
  }
  return out
}

export type Verdict = 'ahead' | 'behind' | 'on'
export interface PaceRow { track: PaceTrack; expected: number; done: number; verdict: Verdict }
/** `hours`: logged focus hours (ruling 24 S3), the same minutes as Today's Focus today and Week's day lines. */
/** Focus time as the Progress well shows it: minutes under an hour ("2 min", as Today and Week say it), else hours ("1.5 h"). */
export function focusText(p: Pick<Pace, 'hours' | 'focusMinutes'>): string {
  return p.focusMinutes > 0 && p.focusMinutes < 60 ? `${p.focusMinutes} min` : `${p.hours} h`
}

export interface Pace { rows: PaceRow[]; hours: number; /** the same minutes, whole (UAT cu-2p P3-3) */ focusMinutes: number; hardSolved: number; finishSprint: number | null }

/** UAT J3: a rate from a day or two is noise ("Projected finish S650" on day 1); project only from a week of data. */
export const PROJECTION_MIN_DAYS = 7

/** Whole days of data: from the first finished card (never before the plan start) to now. */
function dataDays(live: Ticket[], startDate: string, nowMs: number): number {
  const doneAts = live.filter(isDone).map(t => t.doneAt).filter((v): v is number => typeof v === 'number')
  const from = Math.max(parseLocalDate(startDate), doneAts.length ? Math.min(...doneAts) : -Infinity)
  return localDaysBetween(from, nowMs)
}

export function pace(tickets: Ticket[], events: readonly StoredEvent[], startDate: string, nowMs: number, lastSprint: number = TOTAL_SPRINTS): Pace {
  const cur = viewSprint(nowMs, startDate, lastSprint)
  const live = liveOf(tickets)
  const rows: PaceRow[] = PACE_TRACKS.map(track => {
    const mine = live.filter(IN[track])
    const expected = cur <= 0 ? 0 : mine.filter(t => t.plannedSprint < cur).length
    const done = mine.filter(isDone).length
    const verdict: Verdict = done > expected ? 'ahead' : done < expected ? 'behind' : 'on'
    return { track, expected, done, verdict }
  })
  const focusMinutes = Math.round(focusMinutesTotal(events))
  const hours = Math.round((focusMinutesTotal(events) / 60) * 10) / 10
  const hardSolved = live.filter(t => t.kind === 'problem' && t.difficulty === 'H' && isDone(t)).length
  const doneAll = live.filter(isDone).length
  let finishSprint: number | null = null
  if (cur > 0 && doneAll > 0 && dataDays(live, startDate, nowMs) >= PROJECTION_MIN_DAYS) {
    const elapsed = Math.min(cur, lastSprint)
    const remaining = live.length - doneAll
    finishSprint = remaining === 0 ? elapsed : elapsed + Math.ceil(remaining / (doneAll / elapsed))
  }
  return { rows, hours, focusMinutes, hardSolved, finishSprint }
}

/**
 * Session outcomes per sprint. With `tickets`, a Solved or Solved-with-help session counts only while its card is still
 * done: unticking a card takes it back to Todo, and its green bar goes with it (UAT cu-2 P3-16); a gave-up attempt stays
 * (it happened, and the card was never done).
 */
export function outcomesBySprint(
  sessions: Session[], startDate: string, tickets?: readonly Ticket[],
): { sprint: number; solved: number; solved_help: number; gave_up: number }[] {
  const doneIds = tickets ? new Set(tickets.filter(isDone).map(t => t.id)) : null
  const by = new Map<number, { solved: number; solved_help: number; gave_up: number }>()
  for (const s of sessions) {
    const sp = sprintOf(s.start, startDate)
    if (sp < 1) continue
    const row = by.get(sp) ?? { solved: 0, solved_help: 0, gave_up: 0 }
    if (s.outcome === 'studied') continue // a study session solves nothing: it is not an outcome column
    if (doneIds && s.outcome !== 'gave_up' && !doneIds.has(s.ticketId)) continue
    row[s.outcome]++
    by.set(sp, row)
  }
  if (by.size === 0) return []
  const last = Math.max(...by.keys())
  return Array.from({ length: last }, (_, i) => ({ sprint: i + 1, ...(by.get(i + 1) ?? { solved: 0, solved_help: 0, gave_up: 0 }) }))
}

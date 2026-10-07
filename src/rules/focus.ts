import type { DojoEvent } from '../data/types'
import { addLocalDays, localDayKey, localDaysBetween, startOfLocalDay } from '../lib/dates'

const valid = (e: DojoEvent): e is Extract<DojoEvent, { t: 'focus' }> =>
  e.t === 'focus' && Number.isFinite(e.minutes) && e.minutes > 0

/** Focus minutes finished on the local day of `nowMs`. A health signal: it never touches XP. */
export function focusMinutesToday(events: readonly DojoEvent[], nowMs: number): number {
  const day = localDayKey(nowMs)
  return events.filter(valid).filter(e => localDayKey(e.at) === day).reduce((a, e) => a + e.minutes, 0)
}

/** Focus minutes over the last `days` local days including today (the load check's real workload). */
export function focusMinutesSince(events: readonly DojoEvent[], nowMs: number, days: number): number {
  const from = startOfLocalDay(addLocalDays(nowMs, -(days - 1)))
  return events.filter(valid).filter(e => e.at >= from && e.at <= nowMs + 1).reduce((a, e) => a + e.minutes, 0)
}

/** Whole local days from the first logged focus minute to `nowMs` (0 with none): how much history a pace has to stand on. */
export function focusHistoryDays(events: readonly DojoEvent[], nowMs: number): number {
  const first = events.filter(valid).reduce((a, e) => Math.min(a, e.at), Infinity)
  return Number.isFinite(first) ? Math.max(0, localDaysBetween(first, nowMs)) : 0
}

/**
 * Ruling 24 S3: ONE source of focus minutes. Today's "Focus today", the Week day line and chart, and Progress "Focus hours"
 * all sum the `focus` events (finished focus blocks), through these. A session's wall-clock length is a different
 * number and is always labelled as the session's own.
 */
export function focusMinutesOnDay(events: readonly DojoEvent[], dayKey: string): number {
  return events.filter(valid).filter(e => localDayKey(e.at) === dayKey).reduce((a, e) => a + e.minutes, 0)
}
/** Focus minutes finished from `from` (inclusive) to `to` (exclusive). */
export function focusMinutesBetween(events: readonly DojoEvent[], from: number, to: number): number {
  return events.filter(valid).filter(e => e.at >= from && e.at < to).reduce((a, e) => a + e.minutes, 0)
}
/** Every logged focus minute. */
export function focusMinutesTotal(events: readonly DojoEvent[]): number {
  return events.filter(valid).reduce((a, e) => a + e.minutes, 0)
}

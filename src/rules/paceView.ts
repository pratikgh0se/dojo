import { isIsoDate, localDaysBetween, parseLocalDate } from '../lib/dates'
import { MAX_BUDGET_MIN } from './prefs'

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** The text of a budget field: a whole number of minutes from 0 to 600, or the reason it is refused. */
export function parseBudget(raw: string): { ok: true; value: number } | { ok: false; message: string } {
  const s = raw.trim()
  if (!/^\d+$/.test(s)) return { ok: false, message: `Enter whole minutes, 0 to ${MAX_BUDGET_MIN}.` }
  const n = Number(s)
  return n <= MAX_BUDGET_MIN ? { ok: true, value: n } : { ok: false, message: `A day holds at most ${MAX_BUDGET_MIN} minutes here.` }
}

/** "Day 12 of your plan." or "Your plan starts in 3 days." No sprint is named. */
export function planPositionLine(startDate: string, nowMs: number): string {
  if (!isIsoDate(startDate)) return ''
  const d = localDaysBetween(parseLocalDate(startDate), nowMs)
  return d >= 0 ? `Day ${d + 1} of your plan.` : `Your plan starts in ${-d} ${-d === 1 ? 'day' : 'days'}.`
}

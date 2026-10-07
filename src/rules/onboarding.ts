import { addLocalDays, isIsoDate, localDayKey, parseLocalDate, startOfLocalDay } from '../lib/dates'

/** Days since the last Monday on the local calendar: Mon 0, Tue 1, … Sun 6. */
const sinceMonday = (ms: number): number => (new Date(ms).getDay() + 6) % 7

/**
 * The onboarding date field's default (controller ruling 21, amending ruling 19's "today"). Sprints run Monday to
 * Sunday because the day types are weekday-bound (Mon AI watch … Sun interview + teach-back), so the default is a Monday:
 * today on a Monday; the Monday just gone on a Tuesday or Wednesday (he starts mid-week 1, yesterday's items are on the
 * Board); otherwise next Monday. Local dates throughout. He can still pick any date.
 */
export function defaultStartDate(nowMs: number): string {
  const today = startOfLocalDay(nowMs)
  const back = sinceMonday(today)
  return localDayKey(addLocalDays(today, back <= 2 ? -back : 7 - back))
}

const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/**
 * Ruling 21: the inline warn note under a start date that isn't a Monday (onboarding and Settings → Plan start). It
 * never blocks saving. Null for a Monday, and for text that isn't a date yet (that is the form error's job, on submit).
 */
export function startDateWarning(iso: string): string | null {
  if (!isIsoDate(iso)) return null
  const day = sinceMonday(parseLocalDate(iso))
  if (day === 0) return null
  return `Sprints follow a Monday-to-Sunday rhythm (Monday is the AI watch day). Starting on ${WEEKDAY_NAMES[day]} puts some of week 1 out of order. Pick a Monday to keep it in order.`
}

export const MID_WEEK_NOTE = "Week 1 started on Monday; its first day's items are on the Board."

/**
 * Ruling 22 D3: the one-line note under the Tue/Wed default (the Monday just gone): null for any other date, so it
 * goes as soon as he picks something else.
 */
export function startDateNote(iso: string, nowMs: number): string | null {
  if (!isIsoDate(iso)) return null
  const today = startOfLocalDay(nowMs)
  const back = sinceMonday(today)
  return back >= 1 && back <= 2 && iso === localDayKey(addLocalDays(today, -back)) ? MID_WEEK_NOTE : null
}

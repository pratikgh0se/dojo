import { localDayKey, startOfLocalDay } from '../lib/dates'

/**
 * The onboarding date field's default: today on the local calendar. Weekday roles are gone (TODAY-08: a weekday is only a
 * minutes budget), so there is no Monday to snap to and no mid-week note. He can still pick any date.
 */
export function defaultStartDate(nowMs: number): string {
  return localDayKey(startOfLocalDay(nowMs))
}

/**
 * The inline warn note under a start date (onboarding and Settings → Plan start). SHELL-27 shows `start-date-warn` "when it
 * applies"; with no weekday roles it never applies, so this is always null. The hook stays written in the screens.
 */
export function startDateWarning(_iso: string): string | null {
  return null
}

/** The one-line note under the default start date (`start-date-note`, SHELL-27 "when it applies"): never applies, always null. */
export function startDateNote(_iso: string, _nowMs: number): string | null {
  return null
}

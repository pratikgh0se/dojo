import { now } from '../lib/clock'
import { isIsoDate } from '../lib/dates'
import { sprintOf } from '../rules/sprint'
import type { DojoDB } from './db'
import { patchSettings } from './db'
import { safeWrite } from './safeWrite'

/** Settings' start date is a text field with the ISO pattern, so its error names the format. */
export const START_DATE_ERROR = 'Pick a valid date (YYYY-MM-DD).'
/** Onboarding's is the native date field, which shows the user's own format (dd/mm/yyyy), so its error names none (P3-3). */
export const START_DATE_PICK_ERROR = 'Pick a valid date.'

export async function saveStartDate(d: DojoDB, value: string, onError: (msg: string) => void, invalidMessage = START_DATE_ERROR): Promise<boolean> {
  if (!isIsoDate(value)) {
    onError(invalidMessage)
    return false
  }
  // Roll-over only covers sprints that end after this moment: earlier ones (a late start) keep their cards left behind.
  const r = await safeWrite(() => patchSettings(d, { startDate: value, trackedFrom: Math.max(1, sprintOf(now(), value)) }), onError)
  return r !== undefined
}

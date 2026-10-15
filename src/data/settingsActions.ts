import { now } from '../lib/clock'
import { isIsoDate } from '../lib/dates'
import { MAX_SESSION_MINUTES, MIN_SESSION_MINUTES, validBudgets, type NavLabels } from '../rules/prefs'
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

export type SettingsResult = { ok: true } | { ok: false; message: string }
export const BUDGETS_ERROR = 'Each day needs a whole number of minutes from 0 to 600'
export const SESSION_MINUTES_ERROR = `Session length must be a whole number from ${MIN_SESSION_MINUTES} to ${MAX_SESSION_MINUTES}`

export async function saveLaneBudgets(d: DojoDB, budgets: number[]): Promise<SettingsResult> {
  if (!validBudgets(budgets)) return { ok: false, message: BUDGETS_ERROR }
  await patchSettings(d, { laneBudgets: [...budgets] })
  return { ok: true }
}
export async function saveCareerLane(d: DojoDB, on: boolean): Promise<SettingsResult> {
  await patchSettings(d, { careerLane: on })
  return { ok: true }
}
export async function saveSessionMinutes(d: DojoDB, minutes: number): Promise<SettingsResult> {
  if (!Number.isInteger(minutes) || minutes < MIN_SESSION_MINUTES || minutes > MAX_SESSION_MINUTES) return { ok: false, message: SESSION_MINUTES_ERROR }
  await patchSettings(d, { sessionMinutes: minutes })
  return { ok: true }
}
export async function saveNavLabels(d: DojoDB, v: NavLabels): Promise<SettingsResult> {
  if (v !== 'intro' && v !== 'always' && v !== 'hover') return { ok: false, message: 'Pick intro, always or hover' }
  await patchSettings(d, { navLabels: v })
  return { ok: true }
}

import type { Ticket } from '../data/types'
import { addLocalDays, pad2, startOfLocalDay } from '../lib/dates'

/**
 * Today's ritual column (R1 F1): the daily AI pulse and the weekly "Try a model" card.
 * Pure rules only; the writes live in data/ritualActions.ts.
 */

export const TRY_MODEL_ID = 'try-new-model'
export const TRY_MODEL_TITLE = 'Try a model'
/** The plan's `rituals.json` entry may override both; these are the values the mockup shows. */
export const DEFAULT_TRY_MINUTES = 30
/** 0 = Sunday, so 6 = Saturday (the Date.getDay convention). */
export const DEFAULT_DUE_WEEKDAY = 6
export const PULSE_MAX = 140

const NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
/** Sunday-first weekday number (0 = Sunday) to its full name. */
export const weekdayName = (wd: number): string => NAMES[((wd % 7) + 7) % 7]
export const weekdayShort = (wd: number): string => weekdayName(wd).slice(0, 3)

/** Monday-first index (0 = Monday ... 6 = Sunday) of a local day. */
export const mondayIndex = (ms: number): number => (new Date(ms).getDay() + 6) % 7
/** Sunday-first weekday number to its Monday-first cell index. */
const cellOf = (wd: number): number => (((wd % 7) + 7) % 7 + 6) % 7

export interface IsoWeek { year: number; week: number; key: string }

/** The ISO 8601 week of a local day: weeks start on Monday, and week 1 holds the year's first Thursday. */
export function isoWeekOf(ms: number): IsoWeek {
  const thursday = new Date(startOfLocalDay(addLocalDays(ms, 3 - mondayIndex(ms))))
  const year = thursday.getFullYear()
  const dayOfYear = Math.round((thursday.getTime() - new Date(year, 0, 1).getTime()) / 86_400_000)
  const week = 1 + Math.floor(dayOfYear / 7)
  return { year, week, key: `${year}-W${pad2(week)}` }
}

export const weekTicketId = (ms: number): string => `ritual-${TRY_MODEL_ID}-${isoWeekOf(ms).key}`
export const weekTicketOrigin = (ms: number): string => `ritual:${TRY_MODEL_ID}:${isoWeekOf(ms).key}`

export type CellState = 'today' | 'due' | 'done' | 'past' | ''
export interface WeekCell { letter: string; state: CellState; /** today's cell, whatever its state: it keeps the white outline */ today: boolean }

const LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

/**
 * The Monday-first week strip. One state per cell, in this order: done (the day this week's run was marked done), due (the due day,
 * also while it is today or already behind), today, past (days before today), otherwise empty.
 */
export function weekStrip(o: { nowMs: number; dueWeekday: number; doneAt?: number }): WeekCell[] {
  const today = mondayIndex(o.nowMs)
  const due = cellOf(o.dueWeekday)
  const monday = startOfLocalDay(addLocalDays(o.nowMs, -today))
  const sunday = startOfLocalDay(addLocalDays(monday, 7))
  const done = o.doneAt !== undefined && o.doneAt >= monday && o.doneAt < sunday ? mondayIndex(o.doneAt) : -1
  return LETTERS.map((letter, i): WeekCell => {
    const state: CellState = i === done ? 'done' : i === due ? 'due' : i === today ? 'today' : i < today ? 'past' : ''
    return { letter, state, today: i === today }
  })
}

export const tryModelBody = (minutes: number, dueWeekday: number): string =>
  `Run one small open model, then note its tokens per second and what limited it. ${minutes} minutes, any day before ${weekdayName(dueWeekday)}.`
export const tryModelPhoneBody = (dueWeekday: number): string =>
  `Due ${weekdayName(dueWeekday)}. Run one small open model and note tokens per second.`

/** The week's ritual ticket. It is created on Open, never on page load. XP stays 0 until Done pays it (5 for a ritual). */
export function weekTicket(nowMs: number, o: { minutes: number; dueWeekday: number }): Ticket {
  return {
    id: weekTicketId(nowMs), origin: weekTicketOrigin(nowMs), track: 'ai', kind: 'ritual', lane: 'ritual',
    title: TRY_MODEL_TITLE, text: tryModelBody(o.minutes, o.dueWeekday), links: [], estMin: o.minutes,
    plannedSprint: 1, sprint: 1, status: 'todo', slidFrom: [], xp: 0, archived: false, order: nowMs,
  }
}

export const pulseId = (day: string): string => `pulse-${day}`

export function pulseWhen(at: number): string {
  const h = new Date(at).getHours()
  return `Logged this ${h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening'}`
}

export type PulseCheck = { ok: true; text: string } | { ok: false; message: string }
export function checkPulseText(raw: string): PulseCheck {
  const text = raw.trim()
  if (text === '') return { ok: false, message: 'Write a line first' }
  if (text.length > PULSE_MAX) return { ok: false, message: `Keep it to ${PULSE_MAX} characters` }
  return { ok: true, text }
}

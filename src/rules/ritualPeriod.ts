import type { Ticket } from '../data/types'
import { addLocalDays, pad2, startOfLocalDay } from '../lib/dates'
import { isoWeekOf, mondayIndex } from './ritual'

/**
 * W5: any `plan.rituals` entry as a period. This generalises the code that read only `try-new-model`.
 * Weekly: the ISO week of now (Monday first); due on `dueWeekday` (0 = Sunday) at `dueHour`; it shows until the end of that local day.
 * Monthly: the calendar month of now; due on the first `dueWeekday` of the month (at `dueHour`, default 00:00); it shows to the end of the month.
 * The plan entries carry `dueHour`, `body` and the monthly `dueWeekday` (W4 owns that data). The two known rituals fall back to the
 * contract values when an entry has none, so the cards work on a plan built before those fields landed.
 */
export const WEEKLY_REVIEW_ID = 'weekly-review'
export const SWAP_DRILL_ID = 'model-swap-drill'
/** Rituals with their own Today card; `RitualSlots` leaves their minted tickets out. */
export const DEDICATED_RITUALS: readonly string[] = ['try-new-model', WEEKLY_REVIEW_ID, SWAP_DRILL_ID]
/** RIT-18: a minted weekly review or swap drill ticket never shows on Today (not as the quest, not in the pick list), whatever its status; the card is the only way in. */
export const isWindowedRitualTicket = (t: Pick<Ticket, 'origin'>): boolean => [WEEKLY_REVIEW_ID, SWAP_DRILL_ID].some(id => t.origin?.startsWith(`ritual:${id}:`))

export interface RitualEntry {
  id: string; title: string; cadence: 'daily' | 'weekly' | 'monthly'; minutes: number
  /** 0 = Sunday ... 6 = Saturday; monthly: the first such weekday of the month */
  dueWeekday?: number
  /** local hour 0 to 23 the card opens */
  dueHour?: number
  body?: string
}
/** The card shows in [dueAt, endAt). */
export interface RitualPeriod { key: string; dueAt: number; endAt: number }

/** rituals.md Data fields (RIT-16, RIT-19, RIT-66, RIT-69): the exact card and ticket text, used only when the plan entry has no `body`. */
const DEFAULT_BODY: Record<string, string> = {
  [WEEKLY_REVIEW_ID]: 'Look back at your week, then write three short lines: what worked, what to change, and a focus for next week.',
  [SWAP_DRILL_ID]: 'Pick a lab you have done. Swap the model it uses, then measure again. Write the before and after numbers in a Pulse or Journal line.',
}
/** The contract's window for the two new rituals: Sunday from 12:00; the first Saturday of the month. */
const DEFAULT_WINDOW: Record<string, { dueWeekday: number; dueHour?: number }> = {
  [WEEKLY_REVIEW_ID]: { dueWeekday: 0, dueHour: 12 },
  [SWAP_DRILL_ID]: { dueWeekday: 6 },
}
export const bodyOf = (e: RitualEntry): string => e.body ?? DEFAULT_BODY[e.id] ?? ''

const atHour = (dayStart: number, hour: number): number => { const d = new Date(dayStart); d.setHours(hour, 0, 0, 0); return d.getTime() }

export function ritualPeriod(e: RitualEntry, nowMs: number): RitualPeriod | null {
  const dflt = DEFAULT_WINDOW[e.id]
  const hour = e.dueHour ?? dflt?.dueHour ?? 0
  const weekday = e.dueWeekday ?? dflt?.dueWeekday ?? 0
  if (e.cadence === 'weekly') {
    const monday = startOfLocalDay(addLocalDays(nowMs, -mondayIndex(nowMs)))
    const day = startOfLocalDay(addLocalDays(monday, ((weekday % 7) + 6) % 7))
    return { key: isoWeekOf(nowMs).key, dueAt: atHour(day, hour), endAt: startOfLocalDay(addLocalDays(day, 1)) }
  }
  if (e.cadence === 'monthly') {
    const n = new Date(nowMs)
    const first = new Date(n.getFullYear(), n.getMonth(), 1)
    const day = new Date(n.getFullYear(), n.getMonth(), 1 + ((((weekday - first.getDay()) % 7) + 7) % 7)).getTime()
    return { key: `${n.getFullYear()}-${pad2(n.getMonth() + 1)}`, dueAt: atHour(day, hour), endAt: new Date(n.getFullYear(), n.getMonth() + 1, 1).getTime() }
  }
  return null
}

/** The period when its card should show now, else null. */
export function ritualOpen(e: RitualEntry, nowMs: number): RitualPeriod | null {
  const p = ritualPeriod(e, nowMs)
  return p && nowMs >= p.dueAt && nowMs < p.endAt ? p : null
}

export const ritualTicketId = (entryId: string, key: string): string => `ritual-${entryId}-${key}`
export const ritualTicketOrigin = (entryId: string, key: string): string => `ritual:${entryId}:${key}`

/** The period's ritual ticket. Created on Open only, never on page load. XP stays 0 until Done pays it (5 for a ritual). */
export function ritualTicket(e: RitualEntry, p: RitualPeriod, nowMs: number): Ticket {
  return {
    id: ritualTicketId(e.id, p.key), origin: ritualTicketOrigin(e.id, p.key), track: 'ai', kind: 'ritual', lane: 'ritual',
    title: e.title, text: bodyOf(e), links: [], estMin: e.minutes,
    plannedSprint: 1, sprint: 1, status: 'todo', slidFrom: [], xp: 0, archived: false, order: nowMs,
  }
}

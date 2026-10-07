import type { Session, Ticket } from '../data/types'
import { addLocalDays, localDayKey, startOfLocalDay } from '../lib/dates'

export type Activity = Map<string, number>

export interface CalCell { key: string; count: number; future: boolean }
export interface CalendarGrid { weeks: CalCell[][]; months: Array<[string, number]> }

/** PLATFORM "Today": the calendar counts sessions with at least this many minutes on the timer. */
export const SESSION_MIN_MINUTES = 10

export function activityByDay(tickets: Ticket[], sessions: Session[]): Activity {
  const out: Activity = new Map()
  const bump = (ms: number) => {
    const k = localDayKey(ms)
    out.set(k, (out.get(k) ?? 0) + 1)
  }
  const counted = sessions.filter(s => s.minutes >= SESSION_MIN_MINUTES)
  const withSessionDay = new Set<string>()
  for (const s of counted) {
    withSessionDay.add(`${s.ticketId}@${localDayKey(s.start)}`)
    withSessionDay.add(`${s.ticketId}@${localDayKey(s.end)}`)
  }
  for (const s of counted) bump(s.start)
  for (const t of tickets) {
    if (
      t.status === 'done' &&
      t.doneAt !== undefined &&
      !t.doneAtApprox &&
      !withSessionDay.has(`${t.id}@${localDayKey(t.doneAt)}`)
    ) {
      bump(t.doneAt)
    }
  }
  return out
}

/**
 * 8 columns of 7 days, each column a week from Sunday to Saturday. The sr-chart `calendar` engine (vendored as it is) draws
 * its "M", "W", "F" labels beside rows 1, 3 and 5, which are Monday, Wednesday and Friday only when row 0 is Sunday; with
 * Monday-first columns every label sat one row low (UAT cu-2 P3-3). The grid is a heat map, so the week's first day is the
 * engine's, not the plan's Monday-to-Sunday rhythm.
 */
export function calendarGrid(a: Activity, nowMs: number): CalendarGrid {
  const today = startOfLocalDay(nowMs)
  const sunday = addLocalDays(today, -new Date(today).getDay() - 49)
  const weeks: CalCell[][] = []
  for (let w = 0; w < 8; w++) {
    const row: CalCell[] = []
    for (let i = 0; i < 7; i++) {
      const day = addLocalDays(sunday, w * 7 + i)
      const key = localDayKey(day)
      row.push({ key, count: a.get(key) ?? 0, future: day > today })
    }
    weeks.push(row)
  }
  const month = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short' }).toUpperCase()
  return { weeks, months: [[month(sunday), 0], [month(today), 7]] }
}

export function calendarTotal(grid: CalendarGrid): number {
  return grid.weeks.flat().reduce((a, c) => a + (c.future ? 0 : c.count), 0)
}

/** The prototype's sr-chart `calendar` data: counts per day, future days null. */
export function calendarChartData(grid: CalendarGrid): { weeks: (number | null)[][]; months: Array<[string, number]> } {
  return { weeks: grid.weeks.map(w => w.map(c => (c.future ? null : c.count))), months: grid.months }
}

export function streak(a: Activity, nowMs: number): number {
  let day = startOfLocalDay(nowMs)
  if (!(a.get(localDayKey(day)) ?? 0)) day = addLocalDays(day, -1)
  let n = 0
  while ((a.get(localDayKey(day)) ?? 0) > 0) {
    n++
    day = addLocalDays(day, -1)
  }
  return n
}

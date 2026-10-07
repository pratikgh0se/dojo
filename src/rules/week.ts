import type { DojoEvent, PlanJson, Ticket } from '../data/types'
import { addLocalDays, localDayKey, startOfLocalDay, WEEKDAYS, weekdayOf, type Weekday } from '../lib/dates'
import { focusMinutesBetween, focusMinutesOnDay } from './focus'
import { planPosition, SPRINT_DAYS, sprintStart, TOTAL_SPRINTS } from './sprint'
import { isRestRole, pickToday, sprintPool } from './today'

export const WEEK_TARGET_MIN = 540

export type DayTrack = 'ai' | 'interview' | 'off' | null

export interface WeekTile {
  day: Weekday
  dateKey: string
  role: string
  isToday: boolean
  rest: boolean
  sprint: number | null
  tickets: Ticket[]
  /** The cards this day lists a second (or later) time this week: "↻ again". Ruling 22 D2 (the Sunday re-solve), and cu-3p P3-11 (any repeat). */
  again: string[]
  done: number
  /** ruling 24 S3: logged focus minutes of that day (finished focus blocks), the same number as Today's "Focus today" */
  minutes: number
}

export interface SprintDay { dateKey: string; day: Weekday; track: DayTrack; isToday: boolean; past: boolean }

export function roleTrack(role: string): DayTrack {
  if (!role) return null
  if (isRestRole(role)) return 'off'
  if (/^ai\b/i.test(role)) return 'ai'
  if (/interview/i.test(role)) return 'interview'
  return null
}

export function weekStartOf(nowMs: number): number {
  const d = startOfLocalDay(nowMs)
  return addLocalDays(d, -((new Date(d).getDay() + 6) % 7))
}

export function weekTiles(
  nowMs: number, startDate: string, rotation: PlanJson['rotation'], tickets: Ticket[], events: readonly DojoEvent[],
  lastSprint: number = TOTAL_SPRINTS,
): WeekTile[] {
  const monday = weekStartOf(nowMs)
  const todayKey = localDayKey(nowMs)
  const listed = new Set<string>()
  return WEEKDAYS.map((day, i) => {
    const ms = addLocalDays(monday, i)
    const dateKey = localDayKey(ms)
    const role = rotation[day] ?? ''
    const rest = isRestRole(role)
    const pos = planPosition(ms, startDate, lastSprint)
    const isToday = dateKey === todayKey
    if (pos.phase !== 'active') return { day, dateKey, role, isToday, rest, sprint: null, tickets: [], again: [], done: 0, minutes: 0 }
    const pool = rest ? [] : sprintPool(tickets, pos.sprint)
    const picks = pool.length ? pickToday(role, pool) : []
    // ruling 22 D2: the plan puts an interview card on a second day on purpose (re-solve it from memory); UAT cu-3p P3-11: a
    // card listed again for want of any other (the one open card of a sprint fills every AI day) is a repeat too, and so is marked
    const again = picks.filter(t => listed.has(t.id)).map(t => t.id)
    for (const t of picks) listed.add(t.id)
    const done = tickets.filter(t => !t.archived && t.childOf === undefined && t.status === 'done' && t.doneAt !== undefined && localDayKey(t.doneAt) === dateKey).length
    const minutes = focusMinutesOnDay(events, dateKey)
    return { day, dateKey, role, isToday, rest, sprint: pos.sprint, tickets: picks, again, done, minutes }
  })
}

/** Logged focus minutes per week (Monday to Sunday), the last `weeks` weeks (ruling 24 S3). */
export function weeklyMinutes(events: readonly DojoEvent[], nowMs: number, weeks = 8): { weekStart: number; minutes: number }[] {
  const current = weekStartOf(nowMs)
  const out: { weekStart: number; minutes: number }[] = []
  for (let k = weeks - 1; k >= 0; k--) {
    const ws = addLocalDays(current, -7 * k)
    const we = addLocalDays(ws, 7)
    out.push({ weekStart: ws, minutes: focusMinutesBetween(events, ws, we) })
  }
  return out
}

export function sprintCalendar(
  nowMs: number, startDate: string, rotation: PlanJson['rotation'], lastSprint: number = TOTAL_SPRINTS,
): { sprint: number; days: SprintDay[] } | null {
  const pos = planPosition(nowMs, startDate, lastSprint)
  if (pos.phase !== 'active') return null
  const start = sprintStart(pos.sprint, startDate)
  const todayKey = localDayKey(nowMs)
  const days = Array.from({ length: SPRINT_DAYS }, (_, i) => {
    const ms = addLocalDays(start, i)
    const dateKey = localDayKey(ms)
    const day = weekdayOf(ms)
    return { dateKey, day, track: roleTrack(rotation[day] ?? ''), isToday: dateKey === todayKey, past: dateKey < todayKey }
  })
  return { sprint: pos.sprint, days }
}

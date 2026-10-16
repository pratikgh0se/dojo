import type { JournalRow, Redo, Session, Ticket, WeeklyReviewRow } from '../data/types'
import { addLocalDays, localDayKey, startOfLocalDay } from '../lib/dates'
import { JOURNAL_LINE_MAX, JOURNAL_TEXT_MAX } from './journal'
import { isoWeekOf, mondayIndex } from './ritual'

// ---------- ISO week keys (`2026-W45`, Monday first) ----------

const WEEK_RE = /^(\d{4})-W(\d{2})$/

/** Monday 00:00 local of a valid ISO week key; null for anything else (a week 54, a week the year does not have). */
export function weekStart(key: string): number | null {
  const m = WEEK_RE.exec(key)
  if (!m) return null
  const jan4 = new Date(Number(m[1]), 0, 4, 12).getTime() // noon, so a DST shift cannot move the day
  const monday1 = startOfLocalDay(addLocalDays(jan4, -mondayIndex(jan4)))
  const start = startOfLocalDay(addLocalDays(monday1, (Number(m[2]) - 1) * 7))
  return isoWeekOf(start).key === key ? start : null
}
/** The next Monday 00:00 (exclusive end of the week); NaN for an invalid key. */
export const weekEnd = (key: string): number => { const s = weekStart(key); return s === null ? NaN : startOfLocalDay(addLocalDays(s, 7)) }
export const prevWeekKey = (key: string): string => isoWeekOf(addLocalDays(weekStart(key) ?? 0, -7) + 12 * 3_600_000).key
export const nextWeekKey = (key: string): string => isoWeekOf(addLocalDays(weekStart(key) ?? 0, 7) + 12 * 3_600_000).key

/** The week a Journal Week view shows: the requested week when it is real and not in the future, else the current one. */
export function resolveWeek(requested: string | null | undefined, current: string): string {
  return typeof requested === 'string' && weekStart(requested) !== null && requested <= current ? requested : current
}

/** "2026-11-02 to 2026-11-08" (Monday to Sunday, local days). */
export function weekRangeLabel(key: string): string {
  const s = weekStart(key)
  return s === null ? key : `${localDayKey(s)} to ${localDayKey(addLocalDays(s, 6))}`
}

/** "6 h 10 min", "8 h", "0 min": no percentage, no colour for under-budget. */
export function fmtHm(min: number): string {
  const total = Math.max(0, Math.round(min))
  const h = Math.floor(total / 60), m = total % 60
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`
}

// ---------- the week at a glance, computed from existing data ----------

export interface ReviewStamp { labId: string; at: number; passed: boolean }
export interface WeekSummary {
  week: string
  ticketsDone: Ticket[]
  labs: { labId: string; state: 'done' | 'proven' }[]
  minutes: number
  budgetMin: number
  timeLine: string
  hardRedos: { redoId: string; ticketId: string; title: string }[]
  hardLines: { day: string; text: string }[]
}

/** `labClosing` maps a lab id to its closing ticket (the lab's last build ticket, R-1). */
export function weekSummary(a: {
  week: string; tickets: readonly Ticket[]; sessions: readonly Session[]; redos: readonly Redo[]; journal: readonly JournalRow[]
  labReviews: readonly ReviewStamp[]; labClosing: Readonly<Record<string, string>>; budgetMin: number
}): WeekSummary {
  const from = weekStart(a.week) ?? 0
  const to = weekEnd(a.week)
  const inWeek = (ms: number): boolean => ms >= from && ms < to
  const live = a.tickets.filter(t => !t.archived)
  const ticketsDone = live
    .filter(t => t.status === 'done' && t.doneAt !== undefined && inWeek(t.doneAt))
    .sort((x, y) => (x.doneAt as number) - (y.doneAt as number) || x.id.localeCompare(y.id))

  // a lab is Proven when a passing review falls in the week, else Done when its closing ticket (its last build ticket) was done in it
  const labIds = [...new Set([...Object.keys(a.labClosing), ...a.labReviews.map(r => r.labId)])].sort()
  const labs = labIds.flatMap((labId): { labId: string; state: 'done' | 'proven' }[] => {
    if (a.labReviews.some(r => r.labId === labId && r.passed && inWeek(r.at))) return [{ labId, state: 'proven' }]
    const closing = live.find(t => t.id === a.labClosing[labId])
    return closing?.status === 'done' && closing.doneAt !== undefined && inWeek(closing.doneAt) ? [{ labId, state: 'done' }] : []
  })

  const minutes = Math.round(a.sessions.filter(s => inWeek(s.start)).reduce((n, s) => n + s.minutes, 0))
  const titleOf = new Map(a.tickets.map(t => [t.id, t.title]))
  const hardRedos = a.redos
    .filter(r => r.source === 'journal_hard' && inWeek(r.createdAt))
    .sort((x, y) => x.createdAt - y.createdAt || x.id.localeCompare(y.id))
    .map(r => ({ redoId: r.id, ticketId: r.ticketId, title: titleOf.get(r.ticketId) ?? r.ticketId }))
  const days = new Set(Array.from({ length: 7 }, (_, i) => localDayKey(addLocalDays(from, i))))
  const hardLines = a.journal.filter(r => days.has(r.day) && r.hardest?.trim()).sort((x, y) => x.day.localeCompare(y.day)).map(r => ({ day: r.day, text: r.hardest as string }))

  return { week: a.week, ticketsDone, labs, minutes, budgetMin: a.budgetMin, timeLine: `${fmtHm(minutes)} of ${fmtHm(a.budgetMin)}`, hardRedos, hardLines }
}

// ---------- the three prompts and the row Save writes ----------

export interface WeeklyForm { worked: string; change: string; focus: string }
export const emptyWeeklyForm: WeeklyForm = { worked: '', change: '', focus: '' }
export const weeklyId = (week: string): string => `wr-${week}`

export const weeklyFormFromRow = (r: WeeklyReviewRow | null | undefined): WeeklyForm => (r ? { worked: r.worked, change: r.change, focus: r.focus } : emptyWeeklyForm)
export const weeklyBlank = (f: WeeklyForm): boolean => !f.worked.trim() && !f.change.trim() && !f.focus.trim()

const text = (s: string): string => s.trim().slice(0, JOURNAL_TEXT_MAX).trim()
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim().slice(0, JOURNAL_LINE_MAX).trim()

/** The row Save writes (one per ISO week, `wr-<week>`, replaced whole): trimmed strings, always present, "" when blank. */
export function weeklyRow(f: WeeklyForm, week: string, nowMs: number): WeeklyReviewRow {
  return { id: weeklyId(week), week, worked: text(f.worked), change: text(f.change), focus: oneLine(f.focus), at: nowMs }
}

export function weeklySaved(f: WeeklyForm, stored: WeeklyReviewRow | null | undefined): boolean {
  if (!stored) return false
  const mine = weeklyRow(f, stored.week, 0)
  return mine.worked === stored.worked && mine.change === stored.change && mine.focus === stored.focus
}

/** The focus line Today shows: the focus of the review with the greatest week (not the last save), hidden when empty. */
export function latestFocus(rows: readonly Pick<WeeklyReviewRow, 'week' | 'focus'>[]): string {
  const last = [...rows].sort((x, y) => (x.week < y.week ? 1 : x.week > y.week ? -1 : 0))[0]
  return last?.focus.trim() ?? ''
}

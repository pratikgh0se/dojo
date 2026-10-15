// R1 W2: the daily journal (docs/contracts/journal.md). Pure rules: which tickets an entry lists, the hard signal and its 14-day
// count, the seven-day strip, the entry form and the row it saves, and the Review card "Add to Review" writes. No XP, no streak.
import type {
  JournalExplain, JournalItem, JournalObstacle, JournalPiece, JournalRating, JournalRow, Redo, Ticket,
} from '../data/types'
import { isIsoDate, localDayKey } from '../lib/dates'

export const JOURNAL_TEXT_MAX = 1000
export const JOURNAL_LINE_MAX = 200
/** The window of the "Came up hard" list: this many local days, ending on the clock day. */
export const HARD_WINDOW_DAYS = 14
/** Hard signals (rating Again or Hard, or explain No) a ticket needs inside the window to be listed. */
export const HARD_THRESHOLD = 2
export const STRIP_DAYS = 7
/** TODAY-49: the Today card shows from this local hour. */
export const JOURNAL_CARD_HOUR = 17

export const RATINGS: readonly { id: JournalRating; label: string }[] = [
  { id: 'again', label: 'Again' }, { id: 'hard', label: 'Hard' }, { id: 'good', label: 'Good' }, { id: 'easy', label: 'Easy' },
]
export const EXPLAINS: readonly { id: JournalExplain; label: string }[] = [
  { id: 'no', label: 'No' }, { id: 'partly', label: 'Partly' }, { id: 'yes', label: 'Yes' },
]
export const OBSTACLES: readonly { id: JournalObstacle; label: string }[] = [
  { id: 'time', label: 'Time' }, { id: 'energy', label: 'Energy' }, { id: 'job', label: 'Job' }, { id: 'tools', label: 'Tools' }, { id: 'other', label: 'Other' },
]

export const journalId = (day: string): string => `journal-${day}`

// ---------- day keys (calendar arithmetic on `YYYY-MM-DD`, never the machine's zone) ----------

const dayNumber = (key: string): number => {
  const [y, m, d] = key.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}
const keyOfNumber = (n: number): string => new Date(n).toISOString().slice(0, 10)

export function addDayKeys(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return keyOfNumber(Date.UTC(y, m - 1, d + n))
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export const shortWeekday = (day: string): string => WEEKDAYS[new Date(dayNumber(day)).getUTCDay()]
export const longWeekday = (day: string): string => WEEKDAY_LONG[new Date(dayNumber(day)).getUTCDay()]

/** The day an entry is about: the requested day when it is a real day on or before the clock day, else the clock day (JOURNAL-09). */
export function resolveDay(requested: string | null | undefined, today: string): string {
  return typeof requested === 'string' && isIsoDate(requested) && requested <= today ? requested : today
}

// ---------- the tickets an entry lists ----------

/** Not archived, done, `doneAt` on that local day; ascending `doneAt` (ties by plan order, then id). Lane and kind do not matter. */
export function listedFor(tickets: readonly Ticket[], day: string): Ticket[] {
  return tickets
    .filter(t => !t.archived && t.status === 'done' && t.doneAt !== undefined && localDayKey(t.doneAt) === day)
    .sort((a, b) => (a.doneAt as number) - (b.doneAt as number) || a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ---------- the hard signal ----------

export const hasHardSignal = (i: Pick<JournalItem, 'rating' | 'explain'>): boolean => i.rating === 'again' || i.rating === 'hard' || i.explain === 'no'

/**
 * Hard count per ticket: the stored items of rows whose day is in the window (the 14 days ending on `today`) that carry a hard
 * signal. Two signals on one item count once. `latest` is the newest such row's day.
 */
export function hardCounts(rows: readonly JournalRow[], today: string): Map<string, { count: number; latest: string }> {
  const from = addDayKeys(today, -(HARD_WINDOW_DAYS - 1))
  const out = new Map<string, { count: number; latest: string }>()
  for (const r of rows) {
    if (r.day < from || r.day > today) continue
    for (const i of r.items) {
      if (!hasHardSignal(i)) continue
      const cur = out.get(i.ticketId)
      out.set(i.ticketId, { count: (cur?.count ?? 0) + 1, latest: cur && cur.latest > r.day ? cur.latest : r.day })
    }
  }
  return out
}

export interface HardEntry { ticket: Ticket; count: number; latest: string }

/** "Came up hard this week": live tickets with at least two signals in the window, highest count first, then newest signal, then id. */
export function hardList(rows: readonly JournalRow[], tickets: readonly Ticket[], today: string): HardEntry[] {
  const byId = new Map(tickets.map(t => [t.id, t]))
  return [...hardCounts(rows, today)]
    .flatMap(([id, c]) => {
      const ticket = byId.get(id)
      return ticket && !ticket.archived && c.count >= HARD_THRESHOLD ? [{ ticket, count: c.count, latest: c.latest }] : []
    })
    .sort((a, b) => b.count - a.count || (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0) || (a.ticket.id < b.ticket.id ? -1 : a.ticket.id > b.ticket.id ? 1 : 0))
}

// ---------- the seven-day strip ----------

export type StripState = 'written' | 'none' | 'blank'
export interface StripCell { day: string; state: StripState }

/** The seven days ending on the clock day, oldest first. Written, no study or blank: no count, no run, nothing for a quiet day. */
export function stripOf(rows: readonly JournalRow[], today: string): StripCell[] {
  const byDay = new Map(rows.map(r => [r.day, r]))
  return Array.from({ length: STRIP_DAYS }, (_, i) => {
    const day = addDayKeys(today, i - (STRIP_DAYS - 1))
    const r = byDay.get(day)
    return { day, state: r ? (r.mode === 'none' ? 'none' : 'written') : 'blank' }
  })
}

// ---------- the entry form ----------

export interface Pick2 { rating: JournalRating | null; explain: JournalExplain | null }
export interface JournalForm {
  mode: 'studied' | 'none'
  picks: Record<string, Pick2>
  hardest: string
  next: string
  notes: string
  obstacle: JournalObstacle | null
  line: string
}

export const emptyForm = (): JournalForm => ({ mode: 'studied', picks: {}, hardest: '', next: '', notes: '', obstacle: null, line: '' })

/** Pressing the pressed option again clears it (the value is then null). */
export const toggle = <T extends string>(cur: T | null, v: T): T | null => (cur === v ? null : v)

export function formFromRow(row: JournalRow | null | undefined): JournalForm {
  if (!row) return emptyForm()
  return {
    mode: row.mode,
    picks: Object.fromEntries(row.items.map(i => [i.ticketId, { rating: i.rating, explain: i.explain }])),
    hardest: row.hardest ?? '', next: row.next ?? '', notes: row.notes ?? '',
    obstacle: row.obstacle ?? null, line: row.line ?? '',
  }
}

const clean = (s: string, max: number): string => s.trim().slice(0, max).trim()
const pickOf = (f: JournalForm, id: string): Pick2 => f.picks[id] ?? { rating: null, explain: null }

/** Something to save: a studied entry needs a rating, an explain option or non-blank text; a no-study entry needs its obstacle. */
export function canSave(f: JournalForm, listedIds: readonly string[]): boolean {
  if (f.mode === 'none') return f.obstacle !== null
  if (listedIds.some(id => pickOf(f, id).rating !== null || pickOf(f, id).explain !== null)) return true
  return [f.hardest, f.next, f.notes].some(s => s.trim() !== '')
}

/** The row Save writes: one item per listed ticket in list order; trimmed text, absent when blank; a no-study row has no items. */
export function rowFromForm(f: JournalForm, day: string, listedIds: readonly string[], nowMs: number): JournalRow {
  const base = { id: journalId(day), day, at: nowMs }
  if (f.mode === 'none') {
    const line = clean(f.line, JOURNAL_LINE_MAX)
    return { ...base, mode: 'none', items: [], ...(f.obstacle ? { obstacle: f.obstacle } : {}), ...(line ? { line } : {}) }
  }
  const text = (s: string): { v: string } | null => { const v = clean(s, JOURNAL_TEXT_MAX); return v ? { v } : null }
  const hardest = text(f.hardest), next = text(f.next), notes = text(f.notes)
  return {
    ...base, mode: 'studied',
    items: listedIds.map(id => ({ ticketId: id, rating: pickOf(f, id).rating, explain: pickOf(f, id).explain })),
    ...(hardest ? { hardest: hardest.v } : {}), ...(next ? { next: next.v } : {}), ...(notes ? { notes: notes.v } : {}),
  }
}

/** The form equals the stored row (the "Saved" state): the row it would write equals the stored one, ignoring the save time and item order. */
export function isSaved(f: JournalForm, stored: JournalRow | null | undefined, listedIds: readonly string[]): boolean {
  if (!stored || stored.mode !== f.mode) return false
  if (f.mode === 'none') return (stored.obstacle ?? null) === f.obstacle && (stored.line ?? '') === clean(f.line, JOURNAL_LINE_MAX)
  const mine = rowFromForm(f, stored.day, listedIds, 0)
  const was = new Map(stored.items.map(i => [i.ticketId, i]))
  const same = mine.items.every(i => (was.get(i.ticketId)?.rating ?? null) === i.rating && (was.get(i.ticketId)?.explain ?? null) === i.explain)
  return same && (stored.hardest ?? '') === (mine.hardest ?? '') && (stored.next ?? '') === (mine.next ?? '') && (stored.notes ?? '') === (mine.notes ?? '')
}

// ---------- Add to Review ----------

export const hardRedoId = (ticketId: string, today: string): string => `jh-${ticketId}-${today}`

/** The ticket's first explain question and its stored answer, when it has both (JOURNAL-20); none for a ticket without them (JOURNAL-21). */
export function pieceOf(t: Pick<Ticket, 'title' | 'explain' | 'explainAnswers'>): JournalPiece | null {
  const question = t.explain?.[0]?.trim()
  const answer = t.explainAnswers?.[0]?.trim()
  return question && answer ? { topic: t.title, question: t.explain![0], answer: t.explainAnswers![0] } : null
}

/** The `journal_hard` redo: stage 0, due on the clock day (deliberately not three days out, as banks are). */
export function hardRedo(t: Ticket, today: string, nowMs: number): Redo {
  const piece = pieceOf(t)
  return {
    id: hardRedoId(t.id, today), ticketId: t.id, source: 'journal_hard', createdAt: nowMs, stage: 0, due: today,
    passed: [], helpCost: 0, refunded: 0, ...(piece ? { piece } : {}),
  }
}

// ---------- the Today card (TODAY-49) ----------

/** `open` from 17:00 local until the clock day has a row (either mode), then `saved`; null before 17:00. Never refers to another day. */
export function journalCardState(nowMs: number, rows: readonly JournalRow[]): 'open' | 'saved' | null {
  if (new Date(nowMs).getHours() < JOURNAL_CARD_HOUR) return null
  const today = localDayKey(nowMs)
  return rows.some(r => r.day === today) ? 'saved' : 'open'
}

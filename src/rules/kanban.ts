import type { Kind, Ticket } from '../data/types'
import { addLocalDays, isIsoDate, localDayKey, localDaysBetween, parseLocalDate } from '../lib/dates'
import { byOrder, isQueued } from './dayMix'
import { laneOf } from './lanes'
import { tagLane, type LaneFilter } from './queue'

/** board.md: the six columns, left to right. `<column>` in every hook. */
export type KColumn = 'todo' | 'backlog' | 'doing' | 'blocked' | 'help' | 'done'
export const KCOLUMNS: readonly KColumn[] = ['todo', 'backlog', 'doing', 'blocked', 'help', 'done']
export const COLUMN_NAME: Record<KColumn, string> = { todo: 'To do', backlog: 'Backlog', doing: 'Doing', blocked: 'Blocked', help: 'Need help', done: 'Done' }
/** The statuses a drop can write (Done has its own path). */
export type SetStatus = 'todo' | 'doing' | 'blocked' | 'help'

export const SPRINT_DAYS = 14
export const MAX_SPRINT = 72
export const BACKLOG_PAGE = 10
export const NOTE_MAX = 140

export interface SprintWindow { n: number; start: string; end: string }

/** board.md "Sprint": the 14-day window of local days that holds the clock day, counted from `startDate`. */
export function sprintWindow(nowMs: number, startDate: string): SprintWindow {
  const first = isIsoDate(startDate) ? parseLocalDate(startDate) : nowMs
  const d = localDaysBetween(first, nowMs)
  const n = Math.min(MAX_SPRINT, Math.max(1, Math.floor(d / SPRINT_DAYS) + 1))
  const start = addLocalDays(first, SPRINT_DAYS * (n - 1))
  return { n, start: localDayKey(start), end: localDayKey(addLocalDays(start, SPRINT_DAYS - 1)) }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const dayMonth = (iso: string): string => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}` }
/** BOARD-02: `Sprint 2 · 28 Oct–10 Nov` (an en dash between the dates, no year). */
export const sprintHeader = (w: SprintWindow): string => `Sprint ${w.n} · ${dayMonth(w.start)}–${dayMonth(w.end)}`

/** board.md "Sprint budget": the sum, over the 14 days of the window, of that weekday's entry (Sunday first). */
export function sprintBudgetMin(w: SprintWindow, budgets: readonly number[]): number {
  const first = parseLocalDate(w.start)
  let sum = 0
  for (let i = 0; i < SPRINT_DAYS; i++) sum += budgets[new Date(addLocalDays(first, i)).getDay()] ?? 0
  return sum
}

/** BOARD-04: hours rounded to one decimal, a trailing `.0` dropped (215 min reads "3.6 h", 960 min "16 h"). */
export function hoursText(min: number): string {
  const h = Math.round((min / 60) * 10) / 10
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`
}

/** README "Reason": trimmed, at most 140 characters. */
export const clampNote = (s: string): string => s.trim().slice(0, NOTE_MAX)

const byDoneDesc = (a: Ticket, b: Ticket): number => (b.doneAt ?? 0) - (a.doneAt ?? 0) || a.id.localeCompare(b.id)

/** board.md "Board tickets" and "Queued ticket" lanes: AI, DSA (bank counts as DSA), Design, and Career only while it is on. */
export function boardTickets(tickets: readonly Ticket[], careerLane: boolean): Ticket[] {
  return tickets.filter(t => {
    if (t.archived || t.mergedInto !== undefined) return false
    const lane = laneOf(t)
    return lane === 'path' || lane === 'dsa' || lane === 'design' || lane === 'bank' || (lane === 'career' && careerLane)
  })
}

export interface BoardModel {
  sprint: SprintWindow
  budgetMin: number
  usedMin: number
  remainingMin: number
  /** minutes of the Done column (feeds "a h of b h") */
  doneMin: number
  todo: Ticket[]
  backlog: Ticket[]
  doing: Ticket[]
  blocked: Ticket[]
  help: Ticket[]
  done: Ticket[]
  /** all Doing tickets, whatever the lane filter (BOARD-45) */
  doingCount: number
  /** BOARD-04: done / (To do + Doing + Blocked + Need help + Done); Backlog is not counted */
  progress: { done: number; total: number }
  hours: { doneMin: number; budgetMin: number; remainingMin: number }
  count: Record<KColumn, number>
}

const counts = (b: Pick<BoardModel, KColumn>): Record<KColumn, number> => ({
  todo: b.todo.length, backlog: b.backlog.length, doing: b.doing.length, blocked: b.blocked.length, help: b.help.length, done: b.done.length,
})

/** board.md Definitions, BOARD-08 to BOARD-13: which column every ticket belongs to. Pure; the lane filter is applied afterwards. */
export function buildBoard(a: { tickets: readonly Ticket[]; careerLane: boolean; startDate: string; budgets: readonly number[]; nowMs: number }): BoardModel {
  const sprint = sprintWindow(a.nowMs, a.startDate)
  const all = boardTickets(a.tickets, a.careerLane)
  const doing = all.filter(t => t.status === 'doing').sort(byOrder)
  const blocked = all.filter(t => t.status === 'blocked').sort(byOrder)
  const help = all.filter(t => t.status === 'help').sort(byOrder)
  const done = all
    .filter(t => { if (t.status !== 'done' || t.doneAt === undefined) return false; const day = localDayKey(t.doneAt); return day >= sprint.start && day <= sprint.end })
    .sort(byDoneDesc)
  const doneMin = done.reduce((s, t) => s + t.estMin, 0)
  const budgetMin = sprintBudgetMin(sprint, a.budgets)
  const usedMin = doing.reduce((s, t) => s + t.estMin, 0) + doneMin
  const remainingMin = budgetMin - usedMin
  // BOARD-08: the longest prefix of the queue, in queue order, whose estimates add up to at most the remaining minutes
  const queue = all.filter(isQueued).sort(byOrder)
  let total = 0
  let cut = 0
  while (cut < queue.length && total + queue[cut].estMin <= remainingMin) { total += queue[cut].estMin; cut++ }
  const todo = queue.slice(0, cut)
  const backlog = queue.slice(cut)
  const model = { todo, backlog, doing, blocked, help, done }
  return {
    sprint, budgetMin, usedMin, remainingMin, doneMin, ...model, doingCount: doing.length,
    progress: { done: done.length, total: todo.length + doing.length + blocked.length + help.length + done.length },
    hours: { doneMin, budgetMin, remainingMin },
    count: counts(model),
  }
}

/** BOARD-44: a lane filter changes what is drawn, never who belongs where; progress and hours stay those of the whole board. */
export function filterBoard(b: BoardModel, lane: LaneFilter): BoardModel {
  if (lane === 'all') return b
  const keep = (ts: Ticket[]): Ticket[] => ts.filter(t => tagLane(t) === lane)
  const f = { todo: keep(b.todo), backlog: keep(b.backlog), doing: keep(b.doing), blocked: keep(b.blocked), help: keep(b.help), done: keep(b.done) }
  return { ...b, ...f, count: counts(f) }
}

/** The card a kind of ticket cannot be finished on (BOARD-29): a design or write-up ticket is finished in its design session. */
export const finishesInSession = (kind: Kind): boolean => kind === 'design' || kind === 'writeup'

export type DropDecision =
  | { do: 'none' }
  | { do: 'toast'; message: string }
  | { do: 'set'; status: SetStatus; editor?: { prefill: string } }
  | { do: 'outcome' }
  | { do: 'complete' }

export const FILLED_IN_PATH_ORDER = 'This sprint fills in Path order, so To do and Backlog cannot be set by dragging.'
export const FINISHED_IN_SESSION = 'A design or write-up ticket is finished in its design session.'

/** What dropping a card on a column does (BOARD-17 to BOARD-31). The same answer serves a drag, Alt+Arrow and the card menu. */
export function decideDrop(t: Pick<Ticket, 'status' | 'kind' | 'blockedNote'>, to: KColumn): DropDecision {
  if (t.status === 'done') return { do: 'none' }
  switch (to) {
    case 'todo':
    case 'backlog':
      return t.status === 'doing' || t.status === 'blocked' || t.status === 'help' ? { do: 'set', status: 'todo' } : { do: 'toast', message: FILLED_IN_PATH_ORDER }
    case 'doing':
      return t.status === 'doing' ? { do: 'none' } : { do: 'set', status: 'doing' }
    case 'blocked':
    case 'help': {
      if (t.status === to) return { do: 'none' }
      const fromParked = t.status === 'blocked' || t.status === 'help'
      return { do: 'set', status: to, editor: { prefill: fromParked ? t.blockedNote ?? '' : '' } }
    }
    case 'done':
      if (finishesInSession(t.kind)) return { do: 'toast', message: FINISHED_IN_SESSION }
      return t.kind === 'problem' ? { do: 'outcome' } : { do: 'complete' }
  }
}

const STEPS: readonly KColumn[] = ['todo', 'doing', 'blocked', 'help', 'done']

/** BOARD-33: Alt+Arrow moves a card one column along To do, Doing, Blocked, Need help, Done; Backlog is skipped. Null at an edge. */
export function altStep(col: KColumn, dir: -1 | 1): KColumn | null {
  if (col === 'done') return null // BOARD-30: a Done card stays
  const i = STEPS.indexOf(col === 'backlog' ? 'todo' : col)
  const to = i + dir
  return to < 0 || to >= STEPS.length ? null : STEPS[to]
}

/** BOARD-35: the targets of "Move to ...": every column but the card's own and Backlog; Done only where the Board can finish the ticket. */
export function cardMenuTargets(col: KColumn, kind: Kind): SetStatusOrDone[] {
  if (col === 'done') return []
  const own = col === 'backlog' ? 'todo' : col
  return (['todo', 'doing', 'blocked', 'help', 'done'] as const).filter(c => c !== own && !(c === 'done' && finishesInSession(kind)))
}
export type SetStatusOrDone = SetStatus | 'done'

/** The column a ticket's own status gives it (To do versus Backlog is the board's call, not the status's). */
export const columnOfStatus = (t: Pick<Ticket, 'status'>): 'todo' | 'doing' | 'blocked' | 'help' | 'done' =>
  t.status === 'doing' || t.status === 'blocked' || t.status === 'help' || t.status === 'done' ? t.status : 'todo'

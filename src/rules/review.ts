// Sprint review numbers (briefs spec §4). Computed in code from events and sessions; the AI only
// writes the prose around them. Pure.
import type { ReviewStats } from '../ai/types'
import type { Session, StoredEvent, Ticket } from '../data/types'
import { addLocalDays, DAY_MS, localDayKey, parseLocalDate } from '../lib/dates'
import { isPart } from './units'
import { SPRINT_DAYS, sprintStart } from './sprint'

const inWindow = (at: number, from: number, to: number) => at >= from && at < to

/** The local day keys of a sprint, first to last. */
export function sprintDays(sprint: number, startDate: string): string[] {
  const s = sprintStart(sprint, startDate)
  return Array.from({ length: SPRINT_DAYS }, (_, i) => localDayKey(addLocalDays(s, i)))
}

/** Longest run of consecutive local days in `days` (a set of 'YYYY-MM-DD'). */
export function longestStreak(days: readonly string[]): number {
  const t = [...new Set(days)].map(parseLocalDate).sort((a, b) => a - b)
  let best = 0
  let run = 0
  for (let i = 0; i < t.length; i++) {
    run = i > 0 && Math.round((t[i] - t[i - 1]) / DAY_MS) === 1 ? run + 1 : 1
    best = Math.max(best, run)
  }
  return best
}

/** Runs of days without focus as "2026-10-07" or "2026-10-07..2026-10-09" (only days that have already begun). */
export function gapRuns(all: readonly string[], focus: ReadonlySet<string>, todayKey: string): string[] {
  const out: string[] = []
  let start: string | null = null
  let prev = ''
  const close = () => { if (start) out.push(start === prev ? start : `${start}..${prev}`); start = null }
  for (const d of all) {
    if (d > todayKey || focus.has(d)) { close(); continue }
    if (!start) start = d
    prev = d
  }
  close()
  return out
}

/** The sprints a card left unfinished that left a mark (a slide, a roll-over): how many times it slipped, when it can tell. */
const leftSprints = (t: Pick<Ticket, 'slidFrom' | 'rolledFrom'>): number[] => [...t.slidFrom, ...(t.rolledFrom ?? [])]

/**
 * A plan item of sprint `n` (ruling 25 R1): a card the plan put in `n`, wherever it sits now. Where it sits, not how it
 * got there, decides what became of it, so every route that moves a card (slide, slide sprint, Move to sprint…, a
 * rebalance, Shift plan, the roll-over) is counted the same way, and an undone move is simply not a move. A card that slid
 * or moved INTO `n` is an earlier (or later) sprint's plan item, never `n`'s.
 */
export function isPlanItemOf(t: Pick<Ticket, 'plannedSprint'>, n: number): boolean {
  return t.plannedSprint === n
}

/** Slipped out of `n` (R1): a plan item of `n`, not done, that now sits in a later sprint. One pulled into an earlier sprint did not slip. */
export const slippedFrom = (t: Pick<Ticket, 'plannedSprint' | 'sprint' | 'status'>, n: number): boolean =>
  isPlanItemOf(t, n) && t.status !== 'done' && t.sprint > n

export interface ReviewInput {
  sprint: number
  startDate: string
  nowMs: number
  tickets: readonly Ticket[]
  sessions: readonly Session[]
  events: readonly StoredEvent[]
}

export function buildReviewStats(i: ReviewInput): ReviewStats {
  const from = sprintStart(i.sprint, i.startDate)
  const to = addLocalDays(from, SPRINT_DAYS)
  const days = sprintDays(i.sprint, i.startDate)
  const focus = new Set<string>()
  for (const s of i.sessions) if (s.minutes > 0 && inWindow(s.start, from, to)) focus.add(localDayKey(s.start))
  for (const e of i.events) if (e.t === 'tick' && inWindow(e.at, from, to)) focus.add(localDayKey(e.at))
  // ruling 20 S4: the review counts plan items: a split card once (done when all its parts are), never its parts
  const live = i.tickets.filter(t => !t.archived && !isPart(t))
  // ruling 25 R1: "planned" is the sprint's own plan items (a split card once), those still in it and those that left it
  // unfinished for a later sprint by any route; "slipped" is the ones that left. A card the plan put elsewhere is not either.
  const planned = live.filter(t => isPlanItemOf(t, i.sprint))
  const slipped = planned.filter(t => slippedFrom(t, i.sprint)).sort((a, b) => a.order - b.order)
    .map(t => ({ id: t.id, title: t.title, rolled: Math.max(1, leftSprints(t).length) }))
  const rate = (pass: number, fail: number) => (pass + fail === 0 ? null : pass / (pass + fail))
  const win = i.events.filter(e => inWindow(e.at, from, to))
  const redoPass = win.filter(e => e.t === 'redo_pass').length
  const redoFail = win.filter(e => e.t === 'redo_fail').length
  const checks = win.filter((e): e is Extract<StoredEvent, { t: 'check' }> => e.t === 'check')
  return {
    sprint: i.sprint,
    planned: planned.length,
    // done in the sprint, or pulled forward and done before it
    done: planned.filter(t => t.sprint <= i.sprint && t.status === 'done').length,
    focusDays: [...focus].sort(),
    longestStreak: longestStreak([...focus]),
    gaps: gapRuns(days, focus, localDayKey(i.nowMs)),
    slipped,
    redoPassRate: rate(redoPass, redoFail),
    checkPassRate: rate(checks.filter(c => c.passed).length, checks.filter(c => !c.passed).length),
  }
}

/** rv-days: "1 day", "<n> days" (Addendum 2). */
export const daysText = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`
export const pctText = (v: number | null): string => (v === null ? 'no data' : `${Math.round(v * 100)}%`)

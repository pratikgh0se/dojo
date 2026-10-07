import { localDayKey, pad2 } from './dates'
import { readJson, removeKey, writeJson, type StorageLike } from './storage'

export const TIMER_KEY = 'dojo-timer'

export type { StorageLike }

export interface TimerState {
  ticketId: string
  sessionStart: number
  start: number
  end: number
  min: number
  running: boolean
  notified: boolean
  /** UAT J3 (D3.5 "paused"): set while paused: the ms that were left. Resume runs them from then. */
  pausedRemaining?: number
  /** the block's full length, kept across a pause (the drain blocks are a share of it) */
  totalMs?: number
}

export interface TimerView {
  running: boolean
  remainingMs: number
  mmss: string
  blocksOn: number
  expired: boolean
  paused: boolean
  /** the run reached 00:00 and was noted (stopped with `notified`): it reads "done" until the next Start or Retreat (UAT cu-2 P3-6) */
  done: boolean
}

function isTimer(v: unknown): v is TimerState {
  if (typeof v !== 'object' || v === null) return false
  const t = v as Record<string, unknown>
  const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x)
  return typeof t.ticketId === 'string' && num(t.sessionStart) && num(t.start) && num(t.end) && num(t.min) && typeof t.running === 'boolean'
}

export function loadTimer(s?: StorageLike): TimerState | null {
  const v = readJson(TIMER_KEY, s, isTimer)
  return v ? { ...v, notified: Boolean(v.notified) } : null
}

export function saveTimer(t: TimerState, s?: StorageLike): void {
  writeJson(TIMER_KEY, t, s)
}

export function clearTimer(s?: StorageLike): void {
  removeKey(TIMER_KEY, s)
}

// Returns the id of the OTHER ticket whose timer is currently running, or null when it's
// safe to start a timer for `ticketId` (no timer running, or it's already this ticket's).
// A single `dojo-timer` key means only one timer can run at once — this refuses to let a
// second Start silently clobber the first ticket's running timer.
export function blockingTimerTicketId(prev: TimerState | null, ticketId: string): string | null {
  if (prev && prev.running && prev.ticketId !== ticketId) return prev.ticketId
  // a study session on another card owns the timer for its breaks too (ux spec: one session at a time)
  const study = studyTicketId()
  return study && study !== ticketId ? study : null
}

function studyTicketId(): string | null {
  try {
    const v: unknown = JSON.parse(globalThis.localStorage?.getItem('dojo-study') ?? 'null')
    const id = (v as { ticketId?: unknown } | null)?.ticketId
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

export function startTimer(prev: TimerState | null, ticketId: string, min: number, now: number): TimerState {
  // Reuse the same ticket's sessionStart only while its previous timer is still running, or it
  // started earlier the same local day — otherwise a stale sessionStart from a much earlier day
  // (stop on day 1, restart on day 2) would misdate/inflate the new session (N1).
  const reuse = prev && prev.ticketId === ticketId && (prev.running || localDayKey(prev.sessionStart) === localDayKey(now))
  const sessionStart = reuse ? prev!.sessionStart : now
  return { ticketId, sessionStart, start: now, end: now + min * 60_000, min, running: true, notified: false }
}

export function stopTimer(t: TimerState): TimerState {
  return { ...t, running: false }
}

/** UAT J3: Pause keeps what is left of the block; nothing is reset. */
export function pauseTimer(t: TimerState, now: number): TimerState {
  if (!t.running) return t
  return { ...t, running: false, notified: false, pausedRemaining: Math.max(0, t.end - now), totalMs: t.totalMs ?? Math.max(1, t.end - t.start) }
}

/** Resume: the rest of the block runs from now (a new run, so the minutes before the pause are banked once). */
export function resumeTimer(t: TimerState, now: number): TimerState {
  if (t.running || t.pausedRemaining === undefined) return t
  const { pausedRemaining, ...rest } = t
  return { ...rest, running: true, notified: false, start: now, end: now + pausedRemaining, totalMs: t.totalMs }
}

export const isPaused = (t: TimerState | null): boolean => !!t && !t.running && t.pausedRemaining !== undefined
/** A run that ended on its own: stopped, noted (`notified`) and not paused. A Retreat clears the timer instead. */
export const isDone = (t: TimerState | null): boolean => !!t && !t.running && t.notified && t.pausedRemaining === undefined

export type DrainBlock = 'full' | 'draining' | 'empty'

/**
 * Prototype timer.blocks: f = elapsed share, k = floor(f × count); i < k empty, i = k draining, else full.
 * Elapsed is computed as `totalMs - remainingMs` (not `1 - remainingMs / totalMs`) and floor gets a tiny
 * epsilon nudge, so exact fractions like 20/25 landing a hair under a boundary in float64 don't round down
 * a whole block (e.g. 20 min left of 25 must read draining at index 1, not index 0).
 */
export function drainBlocks(remainingMs: number, totalMs: number, count = 5): DrainBlock[] {
  const elapsedMs = Math.max(0, totalMs - Math.max(0, remainingMs))
  const f = totalMs > 0 ? elapsedMs / totalMs : 1
  const k = Math.floor(f * count + 1e-9)
  return Array.from({ length: count }, (_, i): DrainBlock => (i < k ? 'empty' : i === k ? 'draining' : 'full'))
}

export function clockLabel(ms: number): string {
  const d = new Date(ms)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

export function timerView(t: TimerState | null, now: number): TimerView {
  const paused = isPaused(t)
  if (!t || (!t.running && !paused)) {
    const done = isDone(t)
    return { running: false, remainingMs: 0, mmss: done ? '00:00' : '--:--', blocksOn: 0, expired: false, paused: false, done }
  }
  // UAT J3: the screen clock can lag Start by a tick; a run never shows more than its own length (25:00, not 25:01)
  const remainingMs = paused ? t.pausedRemaining! : Math.min(Math.max(0, t.end - t.start), Math.max(0, t.end - now))
  const secs = Math.ceil(remainingMs / 1000)
  const total = Math.max(1, t.totalMs ?? t.end - t.start)
  return {
    running: !paused,
    remainingMs,
    mmss: `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`,
    blocksOn: Math.ceil((5 * remainingMs) / total),
    expired: !paused && remainingMs === 0,
    paused,
    done: false,
  }
}

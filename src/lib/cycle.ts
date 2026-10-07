import { newId } from './id'
import { localDayKey } from './dates'
import { readJson, removeKey, writeJson, type StorageLike } from './storage'
import { isPaused, type TimerState } from './timer'

/** C-LADDER §2.2: the attempt cycle, one per ticket, from the first Do visit to the next outcome. */
export const CYCLE_PREFIX = 'dojo-cycle:'
/** C-LADDER §2.3: the given-up view survives reload until the learner leaves Do. */
export const GAVE_UP_KEY = 'dojo-gaveup'

export interface Cycle {
  /** identity of this attempt cycle - rungUses key off this (RungUse.cycleId), not attemptStart:
   * a wall clock that is frozen or adjusted mid-session can hand two distinct cycles the exact
   * same attemptStart, but never the same id (newId() always mints a fresh one). */
  id: string
  ticketId: string
  attemptStart: number
  redoId: string | null
  redoStage: 0 | 1 | 2 | null
  netAtStart: number
  bankedMs: number
  bankedRunStarts: number[]
}

export interface GaveUp {
  ticketId: string
  /** the cycle this given-up view represents - see Cycle.id's doc comment */
  cycleId: string
  attemptStart: number
  sessionId: string
  at: number
  elapsedMs: number
  netAtStart: number
  redoId: string
  redoDue: number
  redoStage: 0 | 1 | 2 | null
  redoSession: boolean
  countsTowardRedo: boolean
  failedRedo: boolean
}

const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x)

function isCycle(v: unknown): v is Cycle {
  if (typeof v !== 'object' || v === null) return false
  const c = v as Record<string, unknown>
  return typeof c.id === 'string' && typeof c.ticketId === 'string' && num(c.attemptStart) && num(c.netAtStart) && num(c.bankedMs) &&
    Array.isArray(c.bankedRunStarts) && (c.redoId === null || typeof c.redoId === 'string')
}

function isGaveUp(v: unknown): v is GaveUp {
  if (typeof v !== 'object' || v === null) return false
  const g = v as Record<string, unknown>
  return typeof g.ticketId === 'string' && typeof g.cycleId === 'string' && typeof g.sessionId === 'string' && typeof g.redoId === 'string' &&
    num(g.attemptStart) && num(g.at) && num(g.redoDue) && num(g.elapsedMs) && num(g.netAtStart)
}

export function loadCycle(ticketId: string, s?: StorageLike): Cycle | null {
  const c = readJson(CYCLE_PREFIX + ticketId, s, isCycle)
  return c && c.ticketId === ticketId ? c : null
}
export function saveCycle(c: Cycle, s?: StorageLike): void {
  writeJson(CYCLE_PREFIX + c.ticketId, c, s)
}
export function clearCycle(ticketId: string, s?: StorageLike): void {
  removeKey(CYCLE_PREFIX + ticketId, s)
}

/**
 * What a paused-and-resumed (or still paused) timer ran before its current window: the block's whole length less what is
 * left of it. A run is only banked into a cycle when one exists, so a Spar pause on Today, before the card's Do screen was
 * ever opened, left those minutes with the timer alone (UAT cu-2 P3-14: "This attempt" lost time).
 */
function ranBefore(t: TimerState): number {
  if (t.totalMs === undefined) return 0
  const left = t.running ? t.end - t.start : t.pausedRemaining ?? 0
  return Math.max(0, t.totalMs - left)
}

export function newCycle(i: {
  ticketId: string; now: number; redo: { id: string; stage: 0 | 1 | 2 } | null; netAtStart: number; timer: TimerState | null
}): Cycle {
  const t = i.timer && i.timer.ticketId === i.ticketId ? i.timer : null
  const attemptStart = t && t.running ? Math.min(i.now, t.start) : i.now
  // a timer of this card that is running or paused belongs to this attempt, with the windows it ran before a pause
  const carried = t && (t.running || isPaused(t)) ? ranBefore(t) : 0
  return {
    id: newId('cyc', i.now), ticketId: i.ticketId, attemptStart, redoId: i.redo?.id ?? null, redoStage: i.redo?.stage ?? null,
    netAtStart: i.netAtStart, bankedMs: carried, bankedRunStarts: [],
  }
}

function liveRunMs(c: Cycle, t: TimerState | null, now: number): number {
  if (!t || t.ticketId !== c.ticketId || t.start < c.attemptStart || c.bankedRunStarts.includes(t.start)) return 0
  if (t.running) return Math.max(0, Math.min(now, t.end) - t.start)
  if (t.notified) return Math.max(0, t.end - t.start)
  return 0
}

export function cycleElapsedMs(c: Cycle, t: TimerState | null, now: number): number {
  return c.bankedMs + liveRunMs(c, t, now)
}

/** Call before stopping a run, on expiry and on an outcome. Returns `c` itself when nothing new is banked. */
export function bankRun(c: Cycle, t: TimerState | null, now: number): Cycle {
  const ms = liveRunMs(c, t, now)
  if (!t || ms === 0) return c
  return { ...c, bankedMs: c.bankedMs + ms, bankedRunStarts: [...c.bankedRunStarts, t.start] }
}

/** An idle cycle from an earlier local day: replaced so a redo that became due since is honoured. */
export function isStaleEmpty(c: Cycle, useCount: number, t: TimerState | null, now: number): boolean {
  return useCount === 0 && cycleElapsedMs(c, t, now) === 0 && localDayKey(c.attemptStart) !== localDayKey(now)
}

export function loadGaveUp(s?: StorageLike): GaveUp | null {
  return readJson(GAVE_UP_KEY, s, isGaveUp)
}
export function saveGaveUp(g: GaveUp, s?: StorageLike): void {
  writeJson(GAVE_UP_KEY, g, s)
}
export function clearGaveUp(s?: StorageLike): void {
  removeKey(GAVE_UP_KEY, s)
}

export function gaveUpFor(ticketId: string, now: number, s?: StorageLike): GaveUp | null {
  const g = loadGaveUp(s)
  if (!g || g.ticketId !== ticketId) return null
  if (localDayKey(g.at) !== localDayKey(now)) {
    clearGaveUp(s)
    return null
  }
  return g
}

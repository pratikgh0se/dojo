import { describe, expect, it } from 'vitest'
import {
  bankRun, clearCycle, cycleElapsedMs, gaveUpFor, isStaleEmpty, loadCycle, loadGaveUp, newCycle, saveCycle, saveGaveUp,
  type GaveUp,
} from '../../src/lib/cycle'
import { pauseTimer, resumeTimer, type TimerState } from '../../src/lib/timer'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-06T21:10:00')
const MIN = 60_000
const timer = (p: Partial<TimerState> = {}): TimerState => ({ ticketId: 'p200', sessionStart: T, start: T, end: T + 25 * MIN, min: 25, running: true, notified: false, ...p })
const fresh = (p: Partial<Parameters<typeof newCycle>[0]> = {}) => newCycle({ ticketId: 'p200', now: T, redo: null, netAtStart: 0, timer: null, ...p })

describe('newCycle', () => {
  it('starts now, or at an earlier running timer on the same ticket, and records a due redo', () => {
    expect(fresh()).toMatchObject({ ticketId: 'p200', attemptStart: T, redoId: null, redoStage: null, netAtStart: 0, bankedMs: 0, bankedRunStarts: [] })
    expect(fresh({ timer: timer({ start: T - 5 * MIN }) }).attemptStart).toBe(T - 5 * MIN)
    expect(fresh({ timer: timer({ ticketId: 'p543', start: T - 5 * MIN }) }).attemptStart).toBe(T)
    expect(fresh({ redo: { id: 'r1', stage: 1 }, netAtStart: 5 })).toMatchObject({ redoId: 'r1', redoStage: 1, netAtStart: 5 })
  })

  it('mints a unique id per cycle, even for two cycles minted at the exact same `now` (I3)', () => {
    expect(fresh().id).toEqual(expect.any(String))
    expect(fresh().id).not.toBe(fresh().id)
  })
})

describe('newCycle after a pause that came before any cycle (UAT cu-2 P3-14)', () => {
  // a Spar run on Today: 3 min, paused, resumed 2 min later, and only then the card's Do screen is opened
  const spar = (): TimerState => {
    const first = timer({ start: T, end: T + 25 * MIN })
    const paused = pauseTimer(first, T + 3 * MIN)
    return resumeTimer(paused, T + 5 * MIN)
  }
  it('counts the minutes run before the pause, plus the window since the resume', () => {
    const t = spar()
    const c = fresh({ now: T + 6 * MIN, timer: t })
    expect(c.bankedMs).toBe(3 * MIN)
    expect(cycleElapsedMs(c, t, T + 6 * MIN)).toBe(4 * MIN)
  })
  it('after several pauses it is the whole run so far', () => {
    let t = timer({ start: T, end: T + 25 * MIN })
    t = resumeTimer(pauseTimer(t, T + 3 * MIN), T + 4 * MIN) // 3 min run, 21:00 + ... left 22 min
    t = resumeTimer(pauseTimer(t, T + 6 * MIN), T + 9 * MIN) // 2 more min run: 5 min in total
    const c = fresh({ now: T + 10 * MIN, timer: t })
    expect(cycleElapsedMs(c, t, T + 10 * MIN)).toBe(6 * MIN) // 5 before the resume + 1 since
  })
  it('a timer still paused carries what it ran, and its resume adds only the new window', () => {
    const paused = pauseTimer(timer({ start: T, end: T + 25 * MIN }), T + 7 * MIN)
    const c = fresh({ now: T + 20 * MIN, timer: paused })
    expect(cycleElapsedMs(c, paused, T + 20 * MIN)).toBe(7 * MIN)
    const resumed = resumeTimer(paused, T + 30 * MIN)
    expect(cycleElapsedMs(c, resumed, T + 32 * MIN)).toBe(9 * MIN)
  })
  it('a first run (never paused), another card\'s timer and a finished one carry nothing', () => {
    expect(fresh({ timer: timer() }).bankedMs).toBe(0)
    expect(fresh({ timer: { ...spar(), ticketId: 'p543' } }).bankedMs).toBe(0)
    expect(fresh({ timer: { ...spar(), running: false, notified: true, pausedRemaining: undefined } }).bankedMs).toBe(0)
  })
})

describe('timer accounting', () => {
  it('H-04 accumulates across a pause: 6 min, stop, 30 min idle, 4 min more = 10 min', () => {
    let c = fresh()
    const run1 = timer()
    expect(cycleElapsedMs(c, run1, T + 6 * MIN)).toBe(6 * MIN)
    c = bankRun(c, run1, T + 6 * MIN)
    const stopped = { ...run1, running: false }
    expect(cycleElapsedMs(c, stopped, T + 36 * MIN)).toBe(6 * MIN)
    const run2 = timer({ start: T + 36 * MIN, end: T + 61 * MIN })
    expect(cycleElapsedMs(c, run2, T + 40 * MIN)).toBe(10 * MIN)
  })
  it('banks a run once; an expired run counts to its end', () => {
    let c = fresh()
    const run = timer()
    c = bankRun(c, run, T + 30 * MIN)
    expect(c.bankedMs).toBe(25 * MIN)
    expect(bankRun(c, run, T + 40 * MIN)).toBe(c)
    const expired = { ...timer({ start: T + 50 * MIN, end: T + 75 * MIN }), running: false, notified: true }
    expect(cycleElapsedMs(c, expired, T + 90 * MIN)).toBe(50 * MIN)
  })
  it('Review Focus 5: another ticket’s timer or one started before the cycle adds nothing', () => {
    const c = fresh()
    expect(cycleElapsedMs(c, timer({ ticketId: 'p543' }), T + 20 * MIN)).toBe(0)
    expect(cycleElapsedMs(c, timer({ start: T - MIN, end: T + 24 * MIN }), T + 20 * MIN)).toBe(0)
    expect(cycleElapsedMs(c, { ...timer(), running: false }, T + 20 * MIN)).toBe(0)
  })
})

describe('staleness', () => {
  it('Review Focus 2: only an untouched cycle from an earlier local day is stale', () => {
    const c = fresh()
    expect(isStaleEmpty(c, 0, null, ist('2026-10-06T23:59:00'))).toBe(false)
    expect(isStaleEmpty(c, 0, null, ist('2026-10-07T00:01:00'))).toBe(true)
    expect(isStaleEmpty(c, 1, null, ist('2026-10-07T00:01:00'))).toBe(false)
    expect(isStaleEmpty({ ...c, bankedMs: MIN }, 0, null, ist('2026-10-07T00:01:00'))).toBe(false)
  })
})

describe('storage', () => {
  it('saves, loads and clears per ticket', () => {
    const c = fresh()
    saveCycle(c)
    expect(loadCycle('p200')).toEqual(c)
    expect(loadCycle('p543')).toBeNull()
    clearCycle('p200')
    expect(loadCycle('p200')).toBeNull()
  })
  it('gaveUpFor returns the record only for its ticket on the same local day, and drops a stale one', () => {
    const g: GaveUp = {
      ticketId: 'p200', cycleId: 'cyc1', attemptStart: T, sessionId: 's1', at: T + 10 * MIN, elapsedMs: 0, netAtStart: 0,
      redoId: 'r1', redoDue: ist('2026-10-09T21:20:00'), redoStage: null, redoSession: false, countsTowardRedo: true, failedRedo: false,
    }
    saveGaveUp(g)
    expect(gaveUpFor('p543', T + 11 * MIN)).toBeNull()
    expect(gaveUpFor('p200', T + 11 * MIN)).toEqual(g)
    expect(gaveUpFor('p200', ist('2026-10-07T09:00:00'))).toBeNull()
    expect(loadGaveUp()).toBeNull()
  })
})

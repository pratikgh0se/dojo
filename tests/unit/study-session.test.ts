import { describe, expect, it } from 'vitest'
import {
  advance, AWAY_MS, dismissStuck, isStudy, markProgress, resumeStudy, phaseLabel, remainingMs, startStudy, takeBreak, type Study,
} from '../../src/rules/studySession'
import { focusHistoryDays, focusMinutesSince, focusMinutesToday } from '../../src/rules/focus'
import type { DojoEvent } from '../../src/data/types'

const MIN = 60_000
const T0 = new Date('2026-10-06T09:00:00+05:30').getTime()
const mk = (over: Partial<Parameters<typeof startStudy>[0]> = {}): Study =>
  startStudy({ id: 'st1', ticketId: 't1', goal: 'do it', cardIds: ['t1'], focusMin: 25, breakMin: 5, chime: true, now: T0, ...over })

describe('startStudy', () => {
  it('starts in a focus phase of the chosen length, long break 3x the short one', () => {
    const s = mk()
    expect(s.phase).toBe('focus')
    expect(s.phaseStart).toBe(T0)
    expect(s.phaseMin).toBe(25)
    expect(s.longBreakMin).toBe(15)
    expect(s.blocks).toBe(0)
    expect(phaseLabel(s)).toBe('Focus')
    expect(remainingMs(s, T0 + 10 * MIN)).toBe(15 * MIN)
    expect(isStudy(JSON.parse(JSON.stringify(s)))).toBe(true)
  })
})

describe('advance: 25/5 cycles', () => {
  it('does nothing before the block ends', () => {
    const r = advance(mk(), T0 + 24 * MIN + 59_000)
    expect(r.finished).toEqual([])
    expect(r.study.phase).toBe('focus')
  })
  it('after 25 minutes the phase is Break and one 25 minute block finished', () => {
    const r = advance(mk(), T0 + 25 * MIN)
    expect(r.study.phase).toBe('break')
    expect(phaseLabel(r.study)).toBe('Break')
    expect(r.finished).toEqual([{ index: 1, start: T0, end: T0 + 25 * MIN, minutes: 25 }])
    expect(r.study.phaseStart).toBe(T0 + 25 * MIN)
    expect(r.switched).toBe(true)
  })
  it('after 5 more it is Focus again', () => {
    const a = advance(mk(), T0 + 25 * MIN).study
    const r = advance(a, T0 + 30 * MIN)
    expect(r.study.phase).toBe('focus')
    expect(r.finished).toEqual([])
    expect(r.study.phaseStart).toBe(T0 + 30 * MIN)
  })
  it('the break after the 4th focus block is a Long break (3x the short break)', () => {
    let s = mk()
    let t = T0
    for (let i = 0; i < 3; i++) {
      t += 25 * MIN
      s = advance(s, t).study
      expect(phaseLabel(s)).toBe('Break')
      t += 5 * MIN
      s = advance(s, t).study
    }
    t += 25 * MIN
    const r = advance(s, t)
    expect(r.study.blocks).toBe(4)
    expect(phaseLabel(r.study)).toBe('Long break')
    expect(r.study.phaseMin).toBe(15)
    expect(advance(r.study, t + 15 * MIN).study.phase).toBe('focus')
  })
  it('a 1 minute custom cycle catches up two blocks inside the away window, listing each', () => {
    const s = mk({ focusMin: 1, breakMin: 1 })
    const r = advance(s, T0 + 3 * MIN) // f1 ends at 1, b at 2, f2 at 3: exactly AWAY (2 min) past the first end
    expect(r.away).toBe(false)
    expect(r.finished.map(f => f.index)).toEqual([1, 2])
  })
  it('a custom cycle uses its own lengths', () => {
    const s = mk({ focusMin: 50, breakMin: 10 })
    const r = advance(s, T0 + 50 * MIN)
    expect(r.finished[0].minutes).toBe(50)
    expect(r.study.phaseMin).toBe(10)
  })
  it('a gap of up to two minutes past the phase end still just switches phase', () => {
    const r = advance(mk(), T0 + 25 * MIN + AWAY_MS)
    expect(r.away).toBe(false)
    expect(r.study.phase).toBe('break')
  })
  it('a longer gap (sleep) credits only the block that was running, then parks the session as away', () => {
    const r = advance(mk(), T0 + 25 * MIN + AWAY_MS + 1)
    expect(r.away).toBe(true)
    expect(r.finished.map(f => f.index)).toEqual([1])
    expect(r.study.away).toBe(T0 + 25 * MIN + AWAY_MS + 1)
    expect(r.study.blocks).toBe(1)
    // parked: nothing more is credited or switched until the user answers
    const later = advance(r.study, T0 + 500 * MIN)
    expect(later.finished).toEqual([])
    expect(later.study).toBe(r.study)
  })
  it('a gap during a break credits nothing at all', () => {
    const inBreak = advance(mk(), T0 + 25 * MIN).study
    const r = advance(inBreak, T0 + 60 * MIN)
    expect(r.away).toBe(true)
    expect(r.finished).toEqual([])
  })
  it('resume restarts the current phase from now and clears the away state', () => {
    const parked = advance(mk(), T0 + 200 * MIN).study // the credited block moved it to Break
    expect(parked.phase).toBe('break')
    const s = resumeStudy(parked, T0 + 210 * MIN)
    expect(s.away).toBeNull()
    expect(s.phase).toBe('break')
    expect(s.phaseStart).toBe(T0 + 210 * MIN)
    expect(s.blocks).toBe(1)
    expect(advance(s, T0 + 214 * MIN).finished).toEqual([])
    expect(advance(s, T0 + 215 * MIN).study.phase).toBe('focus')
  })
})

describe('stuck prompt', () => {
  it('is pending when a focus block ends with no progress', () => {
    const r = advance(mk(), T0 + 25 * MIN)
    expect(r.study.stuck).toBe(true)
  })
  it('is not pending when progress was made in the block', () => {
    const s = markProgress(mk())
    expect(advance(s, T0 + 25 * MIN).study.stuck).toBe(false)
  })
  it('progress in a break does not count toward the next block', () => {
    const b = advance(mk(), T0 + 25 * MIN).study
    expect(markProgress(b).progress).toBe(false)
  })
  it('is per block: progress resets, and the next block can prompt once more', () => {
    let s = markProgress(mk())
    s = advance(s, T0 + 25 * MIN).study
    s = advance(s, T0 + 30 * MIN).study
    expect(s.progress).toBe(false)
    expect(s.stuck).toBe(false)
    const r = advance(s, T0 + 55 * MIN)
    expect(r.study.stuck).toBe(true)
  })
  it('dismissing clears it, and it never re-arms inside the same block', () => {
    let s = advance(mk(), T0 + 25 * MIN).study
    s = dismissStuck(s)
    expect(s.stuck).toBe(false)
    expect(advance(s, T0 + 27 * MIN).study.stuck).toBe(false)
  })
  it('starting the next block clears an unanswered prompt', () => {
    const s = advance(mk(), T0 + 25 * MIN).study
    expect(advance(s, T0 + 30 * MIN).study.stuck).toBe(false)
  })
  it('take a 5 minute break restarts the break as exactly 5 minutes from now and clears the prompt', () => {
    const s = advance(mk({ focusMin: 50, breakMin: 10 }), T0 + 50 * MIN).study
    const b = takeBreak(s, T0 + 51 * MIN, 5)
    expect(b.phase).toBe('break')
    expect(b.phaseStart).toBe(T0 + 51 * MIN)
    expect(b.phaseMin).toBe(5)
    expect(b.stuck).toBe(false)
    expect(b.blocks).toBe(1)
  })
})

describe('focus minutes (a health signal, never XP)', () => {
  const ev = (at: number, minutes: number): DojoEvent => ({ t: 'focus', id: 't1', at, minutes })
  it('sums today only, by local day', () => {
    const events: DojoEvent[] = [
      ev(T0, 25), ev(T0 + 30 * MIN, 25), ev(T0 - 24 * 60 * MIN, 50),
      { t: 'tick', id: 't1', at: T0, xp: 10 },
    ]
    expect(focusMinutesToday(events, T0 + 60 * MIN)).toBe(50)
  })
  it('sums a trailing window for the load check', () => {
    const events: DojoEvent[] = [ev(T0, 25), ev(T0 - 3 * 24 * 60 * MIN, 25), ev(T0 - 9 * 24 * 60 * MIN, 25)]
    expect(focusMinutesSince(events, T0 + MIN, 7)).toBe(50)
  })
  it('ignores malformed minutes', () => {
    expect(focusMinutesToday([ev(T0, Number.NaN), ev(T0, -5)], T0)).toBe(0)
  })
})

describe('focusHistoryDays (ruling 24 S2)', () => {
  const ev = (at: number, minutes = 25) => ({ t: 'focus' as const, id: 'a', at, minutes })
  it('is the whole local days from the first logged focus minute, and 0 with none', () => {
    expect(focusHistoryDays([], T0)).toBe(0)
    expect(focusHistoryDays([ev(T0)], T0 + 5 * MIN)).toBe(0)
    expect(focusHistoryDays([ev(T0 - 7 * 24 * 60 * MIN), ev(T0)], T0)).toBe(7)
    expect(focusHistoryDays([ev(T0 - 3 * 24 * 60 * MIN, Number.NaN), ev(T0 - 40 * 24 * 60 * MIN, -5)], T0)).toBe(0)
  })
})

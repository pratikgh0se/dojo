import { describe, expect, it } from 'vitest'
import { isPaused, pauseTimer, resumeTimer, startTimer, timerView } from '../../src/lib/timer'
import { advance, pauseStudy, remainingMs, resumePausedStudy, startStudy } from '../../src/rules/studySession'
import { bankRun, cycleElapsedMs, newCycle } from '../../src/lib/cycle'

const MIN = 60_000
// UAT J3 (ui-do D3.5): Pause keeps the timer where it is; Resume continues from the paused time.
describe('the Do timer pauses and resumes', () => {
  it('Pause keeps the time left (state "paused"), Resume runs it on from then; the attempt counts each minute once', () => {
    const t0 = 1_000_000
    const run = startTimer(null, 'p1', 25, t0)
    let cycle = newCycle({ ticketId: 'p1', now: t0 - 1, redo: null, netAtStart: 0, timer: null })
    cycle = bankRun(cycle, run, t0 + 10 * MIN)
    const paused = pauseTimer(run, t0 + 10 * MIN)
    expect(isPaused(paused)).toBe(true)
    const v = timerView(paused, t0 + 30 * MIN) // time passes while paused: nothing moves
    expect(v).toMatchObject({ paused: true, running: false, mmss: '15:00', expired: false })
    expect(cycleElapsedMs(cycle, paused, t0 + 30 * MIN)).toBe(10 * MIN)
    const resumed = resumeTimer(paused, t0 + 30 * MIN)
    expect(timerView(resumed, t0 + 35 * MIN)).toMatchObject({ running: true, paused: false, mmss: '10:00' })
    expect(cycleElapsedMs(cycle, resumed, t0 + 35 * MIN)).toBe(15 * MIN)
    expect(timerView(resumed, t0 + 45 * MIN).expired).toBe(true)
  })
})

describe('the study session pauses and resumes', () => {
  it('a paused phase never advances; Resume runs the rest of it from now', () => {
    const t0 = 2_000_000
    const s = startStudy({ id: 's', ticketId: 'p1', goal: 'g', cardIds: ['p1'], focusMin: 25, breakMin: 5, chime: false, now: t0 })
    const p = pauseStudy(s, t0 + 10 * MIN)
    expect(remainingMs(p, t0 + 60 * MIN)).toBe(15 * MIN)
    expect(advance(p, t0 + 60 * MIN).switched).toBe(false)
    const r = resumePausedStudy(p, t0 + 60 * MIN)
    expect(remainingMs(r, t0 + 61 * MIN)).toBe(14 * MIN)
    const a = advance(r, t0 + 75 * MIN)
    expect(a.study.phase).toBe('break')
    expect(a.finished[0].minutes).toBe(25)
  })
})

describe('UAT J3: the readout starts at the block length', () => {
  it('shows 25:00, never 25:01, when the screen clock lags the start by a tick', () => {
    const t = startTimer(null, 'x', 25, 10_000)
    expect(timerView(t, 10_000).mmss).toBe('25:00')
    expect(timerView(t, 9_200).mmss).toBe('25:00') // the last tick was 0.8 s before Start
    expect(timerView(t, 11_000).mmss).toBe('24:59')
    // a resumed block never shows more than it had left either
    const paused = pauseTimer(t, 70_000) // 24:00 left
    const resumed = resumeTimer(paused, 100_000)
    expect(timerView(resumed, 99_500).mmss).toBe('24:00')
  })
})

describe('UAT J3: the study session readout starts at the phase length', () => {
  it('never reads more than the phase', () => {
    const s = startStudy({ id: 's', ticketId: 'x', goal: '', cardIds: ['x'], focusMin: 25, breakMin: 5, chime: false, now: 10_000 })
    expect(remainingMs(s, 9_000)).toBe(25 * 60_000)
  })
})

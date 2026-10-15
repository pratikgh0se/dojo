import { describe, expect, it } from 'vitest'
import { advance, pauseStudy, remainingMs, resumePausedStudy, startStudy } from '../../src/rules/studySession'

const MIN = 60_000
const t0 = 1_000_000
const single = () => startStudy({ id: 'st', ticketId: 't', goal: '', cardIds: ['t'], focusMin: 25, breakMin: 5, chime: false, now: t0, single: true })

describe('single-block study session', () => {
  it('counts down and does not move before the end', () => {
    const s = single()
    expect(s.single).toBe(true)
    expect(remainingMs(s, t0 + 10 * MIN)).toBe(15 * MIN)
    const r = advance(s, t0 + 24 * MIN)
    expect(r.switched).toBe(false)
  })
  it('credits one block at the end, reads 00:00, and stays in focus', () => {
    const r = advance(single(), t0 + 25 * MIN)
    expect(r.switched).toBe(true)
    expect(r.finished).toEqual([{ index: 1, start: t0, end: t0 + 25 * MIN, minutes: 25 }])
    expect(r.study).toMatchObject({ phase: 'focus', over: true, blocks: 1 })
    expect(remainingMs(r.study, t0 + 99 * MIN)).toBe(0)
  })
  it('credits it once even after a long sleep, and never advances again', () => {
    const r = advance(single(), t0 + 8 * 60 * MIN)
    expect(r.finished).toHaveLength(1)
    expect(r.away).toBe(false)
    const again = advance(r.study, t0 + 9 * 60 * MIN)
    expect(again.switched).toBe(false)
    expect(again.finished).toEqual([])
  })
  it('leaves the pomodoro session as it was', () => {
    const s = startStudy({ id: 'st', ticketId: 't', goal: '', cardIds: ['t'], focusMin: 25, breakMin: 5, chime: false, now: t0 })
    expect(s.single).toBeUndefined()
    expect(advance(s, t0 + 25 * MIN).study.phase).toBe('break')
  })
  it('cannot be paused or resumed once the time is up (TICKET-07/09)', () => {
    const over = advance(single(), t0 + 25 * MIN).study
    expect(pauseStudy(over, t0 + 26 * MIN)).toBe(over)
    expect(resumePausedStudy(over, t0 + 27 * MIN)).toBe(over)
  })
})

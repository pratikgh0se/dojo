import { describe, expect, it } from 'vitest'
import { parseBudget, planPositionLine } from '../../src/rules/paceView'
import { breakFor, planFor } from '../../src/rules/sessionPlan'

describe('paceView', () => {
  it('parses a budget field', () => {
    expect(parseBudget(' 45 ')).toEqual({ ok: true, value: 45 })
    expect(parseBudget('0')).toEqual({ ok: true, value: 0 })
    expect(parseBudget('600')).toEqual({ ok: true, value: 600 })
    for (const bad of ['', '-5', '1.5', 'abc', '601']) expect(parseBudget(bad)).toMatchObject({ ok: false })
  })
  it('counts the day of the plan without naming a sprint', () => {
    const at = new Date(2026, 10, 12, 9).getTime()
    expect(planPositionLine('2026-11-02', at)).toBe('Day 11 of your plan.')
    expect(planPositionLine('2026-11-14', at)).toBe('Your plan starts in 2 days.')
    expect(planPositionLine('2026-11-13', at)).toBe('Your plan starts in 1 day.')
    expect(planPositionLine('', at)).toBe('')
    expect(planPositionLine('2026-13-45', at)).toBe('')
  })
})

describe('sessionPlan', () => {
  it('derives the break from the focus length', () => {
    expect(breakFor(25)).toBe(5)
    expect(breakFor(50)).toBe(10)
  })
  it('plans one card with no goal, at the remembered length, as a single block', () => {
    expect(planFor({ id: 't1' }, { sessionMinutes: 50 }, true)).toEqual({ goal: '', focusMin: 50, breakMin: 10, cardIds: ['t1'], chime: true, single: true })
    expect(planFor({ id: 't1' }, undefined, false).focusMin).toBe(25)
    expect(planFor({ id: 't1' }, { sessionMinutes: 3 }, false).focusMin).toBe(25)
  })
})

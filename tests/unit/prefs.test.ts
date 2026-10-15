import { describe, expect, it } from 'vitest'
import { budgetsOf, careerLaneOf, coreMinutesOf, DEFAULT_BUDGETS, navLabelsOf, sessionMinutesOf, validBudgets, weeklyTotal } from '../../src/rules/prefs'

describe('budgetsOf', () => {
  it('prefers valid stored budgets, then the plan mix, then the defaults', () => {
    expect(budgetsOf({ laneBudgets: [1, 2, 3, 4, 5, 6, 7] }, { budgets: [9, 9, 9, 9, 9, 9, 9] })).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(budgetsOf({}, { budgets: [9, 9, 9, 9, 9, 9, 9] })).toEqual([9, 9, 9, 9, 9, 9, 9])
    expect(budgetsOf(undefined)).toEqual([90, 60, 60, 60, 30, 30, 150])
  })
  it('malformed stored budgets fall back instead of producing NaN (Review Focus 2)', () => {
    for (const bad of [[1, 2, 3], [-1, 0, 0, 0, 0, 0, 0], ['a', 1, 1, 1, 1, 1, 1], [1.5, 1, 1, 1, 1, 1, 1], [601, 1, 1, 1, 1, 1, 1]]) {
      expect(budgetsOf({ laneBudgets: bad as number[] })).toEqual([...DEFAULT_BUDGETS])
      expect(validBudgets(bad)).toBe(false)
    }
    expect(validBudgets([0, 0, 0, 0, 0, 0, 0])).toBe(true)
  })
  it('the returned array is a copy', () => {
    const b = budgetsOf({}); b[0] = 1
    expect(DEFAULT_BUDGETS[0]).toBe(90)
  })
})

describe('coreMinutesOf', () => {
  it('is twice the weekly total unless a valid value is stored (960 by default)', () => {
    expect(weeklyTotal(DEFAULT_BUDGETS)).toBe(480)
    expect(coreMinutesOf(undefined)).toBe(960)
    expect(coreMinutesOf({})).toBe(960)
    expect(coreMinutesOf({ coreMinutes: 120 })).toBe(120)
    expect(coreMinutesOf({ coreMinutes: 3 })).toBe(960)
    expect(coreMinutesOf({ coreMinutes: NaN })).toBe(960)
    expect(coreMinutesOf({ laneBudgets: [60, 60, 60, 60, 60, 60, 60] })).toBe(840)
  })
})

describe('small settings', () => {
  it('have defaults', () => {
    expect(careerLaneOf(undefined)).toBe(false)
    expect(careerLaneOf({ careerLane: true })).toBe(true)
    expect(sessionMinutesOf({})).toBe(25)
    expect(sessionMinutesOf({ sessionMinutes: 40 })).toBe(40)
    expect(sessionMinutesOf({ sessionMinutes: 4 })).toBe(25)
    expect(navLabelsOf({})).toBe('intro')
    expect(navLabelsOf({ navLabels: 'always' })).toBe('always')
    expect(navLabelsOf({ navLabels: 'x' as never })).toBe('intro')
  })
})

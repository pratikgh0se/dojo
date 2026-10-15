import { describe, expect, it } from 'vitest'
import { headerXp, levelOf } from '../../src/rules/xp'

describe('headerXp (README "Header numbers")', () => {
  it('sums xp over tickets without mergedInto and ignores merged parts', () => {
    expect(headerXp([{ xp: 10 }, { xp: 5, mergedInto: 'a' }, { xp: 7 }])).toBe(17)
    expect(levelOf(headerXp([{ xp: 10 }, { xp: 5, mergedInto: 'a' }, { xp: 7 }]))).toBe(1)
    expect(headerXp([])).toBe(0)
  })
})

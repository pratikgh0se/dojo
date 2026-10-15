import { describe, expect, it } from 'vitest'
import { baseXp } from '../../src/rules/xp'

describe('xp defaults by kind (spec 3.2, TICKET-11)', () => {
  it('gives the flat-queue kinds their values and keeps the old ones', () => {
    expect(baseXp('watch')).toBe(10)
    expect(baseXp('read')).toBe(10)
    expect(baseXp('task')).toBe(10)
    expect(baseXp('build')).toBe(20)
    expect(baseXp('writeup')).toBe(20)
    expect(baseXp('ritual')).toBe(5)
    expect(baseXp('problem', 'E')).toBe(5)
    expect(baseXp('problem', 'M')).toBe(10)
    expect(baseXp('problem', 'H')).toBe(15)
    expect(baseXp('design')).toBe(20)
  })
})

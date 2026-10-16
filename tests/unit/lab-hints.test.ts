import { describe, expect, it } from 'vitest'
import { nextRung, rungAllowed, rungShown, withHelp } from '../../src/rules/labHints'

const h = (ticketId: string, rung: 1 | 2 | 3) => ({ ticketId, rung, at: 1 })

describe('nextRung', () => {
  it('starts at 1, then follows the rungs shown for THAT ticket, then null', () => {
    expect(nextRung([], 'T1')).toBe(1)
    expect(nextRung([h('T1', 1)], 'T1')).toBe(2)
    expect(nextRung([h('T1', 1), h('T1', 2)], 'T1')).toBe(3)
    expect(nextRung([h('T1', 1), h('T1', 2), h('T1', 3)], 'T1')).toBeNull()
    expect(nextRung([h('T1', 1), h('T1', 2), h('T1', 3)], 'T2')).toBe(1) // rungs are per ticket
  })
  it('tolerates a duplicate entry', () => {
    expect(nextRung([h('T1', 1), h('T1', 1)], 'T1')).toBe(2)
  })
})

describe('withHelp', () => {
  it('is true once a rung 3 was shown on any ticket, and never for rungs 1 and 2', () => {
    expect(withHelp([])).toBe(false)
    expect(withHelp([h('T1', 1), h('T1', 2)])).toBe(false)
    expect(withHelp([h('T1', 1), h('T2', 3)])).toBe(true)
  })
})

describe('rungShown and rungAllowed', () => {
  it('a rung may be opened when it is next, or again when it was shown; never ahead', () => {
    const hints = [h('T1', 1)]
    expect(rungShown(hints, 'T1', 1)).toBe(true)
    expect(rungShown(hints, 'T2', 1)).toBe(false)
    expect(rungAllowed(hints, 'T1', 1)).toBe(true)
    expect(rungAllowed(hints, 'T1', 2)).toBe(true)
    expect(rungAllowed(hints, 'T1', 3)).toBe(false)
    expect(rungAllowed([], 'T1', 2)).toBe(false)
  })
})

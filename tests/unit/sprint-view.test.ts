import { describe, expect, it } from 'vitest'
import { blockOf, blockSprints, SPRINTS_PER_BLOCK, TOTAL_BLOCKS, viewSprint } from '../../src/rules/sprint'
import { liveTicketMap, rowMeta } from '../../src/rules/board'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const START = '2026-10-05'

describe('viewSprint (Review Focus #5)', () => {
  it('is 0 before the start date', () => {
    expect(viewSprint(ist('2026-10-04T23:59:00'), START)).toBe(0)
  })
  it('is the active sprint inside the plan window', () => {
    expect(viewSprint(ist('2026-10-05T00:00:00'), START)).toBe(1)
    expect(viewSprint(ist('2026-10-18T23:59:00'), START)).toBe(1)
    expect(viewSprint(ist('2026-10-19T00:00:00'), START)).toBe(2)
  })
  it('is lastSprint + 1 after the plan window', () => {
    expect(viewSprint(ist('2030-01-01T09:00:00'), START)).toBe(73)
    expect(viewSprint(ist('2030-06-01T09:00:00'), START, 74)).toBe(75)
  })
})

describe('blocks', () => {
  it('has 18 blocks of 4 sprints', () => {
    expect(SPRINTS_PER_BLOCK).toBe(4)
    expect(TOTAL_BLOCKS).toBe(18)
    expect([1, 4, 5, 72].map(blockOf)).toEqual([1, 1, 2, 18])
    expect(blockSprints(1)).toEqual([1, 4])
    expect(blockSprints(18)).toEqual([69, 72])
  })
})

describe('row helpers', () => {
  it('rowMeta shows the home sprint and the last sprint it slid from', () => {
    expect(rowMeta(mkTicket({ id: 'a', sprint: 7 }))).toBe('S7')
    expect(rowMeta(mkTicket({ id: 'a', sprint: 7, slidFrom: [3, 5] }))).toBe('S7 · from S5')
  })
  it('liveTicketMap drops archived tickets', () => {
    const m = liveTicketMap([mkTicket({ id: 'a' }), mkTicket({ id: 'b', archived: true })])
    expect([...m.keys()]).toEqual(['a'])
  })
})

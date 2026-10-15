import { describe, expect, it } from 'vitest'
import { budgetFor, dailyMix, effectiveOrder } from '../../src/rules/dayMix'
import type { Lane, Ticket } from '../../src/data/types'
import { mkTicket } from '../helpers/tickets'

const BUDGETS = [90, 60, 60, 60, 30, 30, 150] // Sunday first
const SUN = new Date(2026, 9, 11, 10, 0)
const MON = new Date(2026, 9, 12, 10, 0)
const THU = new Date(2026, 9, 15, 10, 0)
const SAT = new Date(2026, 9, 17, 10, 0)

const tk = (id: string, lane: Lane, order: number, estMin: number, extra: Partial<Ticket> = {}): Ticket =>
  mkTicket({
    id, lane, order, estMin, track: lane === 'path' ? 'ai' : 'interview',
    kind: lane === 'dsa' ? 'problem' : lane === 'design' ? 'design' : 'build', ...extra,
  })
const ids = (ts: Ticket[]) => ts.map(t => t.id)
const mix = (tickets: Ticket[], date: Date, over: { careerLane?: boolean; budgets?: number[] } = {}) =>
  dailyMix({ tickets, date, budgets: over.budgets ?? BUDGETS, careerLane: over.careerLane ?? false })

describe('budgetFor and effectiveOrder', () => {
  it('indexes the budgets by Date.getDay (Sunday = 0)', () => {
    expect([SUN, MON, THU, SAT].map(d => budgetFor(d, BUDGETS))).toEqual([90, 60, 30, 150])
  })
  it('orderOverride beats order, and a missing order sorts last', () => {
    expect(effectiveOrder(tk('a', 'dsa', 5, 30, { orderOverride: 0.5 }))).toBe(0.5)
    expect(effectiveOrder(tk('b', 'dsa', 5, 30))).toBe(5)
  })
})

describe('dailyMix', () => {
  it('a started Career ticket stays out of the mix while the lane is off, and joins it when the lane is on (TODAY-09, TODAY-10)', () => {
    const t = [tk('c1', 'career', 1, 30, { status: 'doing' }), tk('p1', 'path', 2, 30), tk('d1', 'dsa', 3, 30)]
    expect(ids(mix(t, MON, { careerLane: false }).items)).toEqual(['p1', 'd1'])
    expect(ids(mix(t, MON, { careerLane: true }).items)).toContain('c1')
  })

  it('budget fit: takes the first open ticket of each lane in effective order while it fits', () => {
    const r = mix([tk('p1', 'path', 1, 20), tk('d1', 'dsa', 2, 30), tk('g1', 'design', 3, 45)], MON)
    expect(ids(r.items)).toEqual(['p1', 'd1'])
    expect(r).toMatchObject({ budget: 60, floor: false, waitsForLongerDay: [], lanesDone: [] })
  })

  it('first-always: one ticket that overruns the budget is still the sitting (75 is within twice 60)', () => {
    const r = mix([tk('p1', 'path', 1, 75), tk('d1', 'dsa', 2, 30)], MON)
    expect(ids(r.items)).toEqual(['p1'])
    expect(r.waitsForLongerDay).toEqual([])
  })

  it('exactly twice the budget still starts (TODAY-12)', () => {
    const r = mix([tk('p1', 'path', 1, 60), tk('d1', 'dsa', 2, 30)], THU)
    expect(ids(r.items)).toEqual(['p1'])
    expect(r.waitsForLongerDay).toEqual([])
  })

  it('over twice the budget on a 30-minute Thursday: the shortest fitting ticket, the long one waits (Review Focus 3)', () => {
    const r = mix([tk('p1', 'path', 1, 75), tk('d1', 'dsa', 2, 30), tk('g1', 'design', 3, 45)], THU)
    expect(ids(r.items)).toEqual(['d1'])
    expect(r.waitsForLongerDay.map(t => t.id)).toEqual(['p1'])
    expect(r.floor).toBe(false)
  })

  it('over twice the budget and nothing fits: the floor day, and the long ticket waits (TODAY-14)', () => {
    const r = mix([tk('p1', 'path', 1, 75), tk('d1', 'dsa', 2, 90), tk('g1', 'design', 3, 120)], THU)
    expect(r.items).toEqual([])
    expect(r.floor).toBe(true)
    expect(r.waitsForLongerDay.map(t => t.id)).toEqual(['p1', 'd1', 'g1']) // every first-open ticket is too long; the card drops the one it starts
  })

  it('doing tickets come first, in effective order, and count against the budget (TODAY-04)', () => {
    const r = mix([
      tk('p-next', 'path', 1, 10), tk('p-doing', 'path', 5, 45, { status: 'doing' }),
      tk('g-doing', 'design', 2, 15, { status: 'doing' }), tk('d1', 'dsa', 3, 30),
    ], MON)
    expect(ids(r.items)).toEqual(['g-doing', 'p-doing'])
  })

  it('a doing ticket represents its lane: the lane head is not added on top of it', () => {
    const r = mix([tk('p-doing', 'path', 5, 15, { status: 'doing' }), tk('p-next', 'path', 6, 10), tk('d1', 'dsa', 3, 30)], MON)
    expect(ids(r.items)).toEqual(['p-doing', 'd1'])
  })

  it('adds one second ticket from a lane when at least 30 minutes remain', () => {
    const r = mix([
      tk('p1', 'path', 1, 30), tk('d1', 'dsa', 2, 30), tk('g1', 'design', 3, 30),
      tk('p2', 'path', 4, 45), tk('d2', 'dsa', 5, 20),
    ], SAT)
    expect(ids(r.items)).toEqual(['p1', 'd1', 'g1', 'p2'])
  })

  it('no second ticket when fewer than 30 minutes remain', () => {
    const r = mix([tk('p1', 'path', 1, 45), tk('p2', 'path', 2, 10)], MON)
    expect(ids(r.items)).toEqual(['p1'])
  })

  it('an empty lane is skipped and reported done', () => {
    const r = mix([tk('p1', 'path', 1, 20), tk('d1', 'dsa', 2, 30)], MON)
    expect(r.lanesDone).toEqual(['design'])
    expect(ids(r.items)).toEqual(['p1', 'd1'])
  })

  it('the career lane is off by default and joins by effective order when on', () => {
    const all = [tk('c1', 'career', 0, 30), tk('p1', 'path', 1, 20)]
    expect(ids(mix(all, MON).items)).toEqual(['p1'])
    expect(mix(all, MON).lanesDone).toEqual(['dsa', 'design'])
    expect(ids(mix(all, MON, { careerLane: true }).items)).toEqual(['c1', 'p1'])
  })

  it('a budget under 20 minutes is the floor day, but a started ticket still resumes', () => {
    const budgets = [90, 60, 60, 60, 15, 30, 150]
    expect(mix([tk('p1', 'path', 1, 20)], THU, { budgets })).toMatchObject({ items: [], floor: true, budget: 15 })
    const r = mix([tk('p1', 'path', 1, 20, { status: 'doing' })], THU, { budgets })
    expect(ids(r.items)).toEqual(['p1'])
    expect(r.floor).toBe(false)
  })

  it('a zero-minute day does not crash and is the floor day (Review Focus 2)', () => {
    const r = mix([tk('p1', 'path', 1, 20)], THU, { budgets: [0, 0, 0, 0, 0, 0, 0] })
    expect(r).toMatchObject({ items: [], floor: true, budget: 0 })
  })

  it('effective order decides the lane head', () => {
    const r = mix([tk('d1', 'dsa', 1, 30), tk('d2', 'dsa', 2, 30, { orderOverride: 0.5 })], MON)
    expect(ids(r.items)).toEqual(['d2', 'd1']) // d2 leads by override; 30 minutes remain, so d1 is the second ticket
  })

  it('ties on order break by id; done, archived and bank tickets never enter', () => {
    const r = mix([
      tk('b', 'dsa', 1, 30), tk('a', 'dsa', 1, 30), tk('x', 'dsa', 0, 30, { status: 'done' }),
      tk('y', 'dsa', 0, 30, { archived: true }), tk('z', 'dsa', 0, 30, { origin: 'bank:blind75' }),
    ], MON)
    expect(ids(r.items)).toEqual(['a', 'b']) // a wins the tie; b is the second ticket (30 minutes remain)
  })
})

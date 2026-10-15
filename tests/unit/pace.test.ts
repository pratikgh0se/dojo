import { describe, expect, it } from 'vitest'
import { paceLine, projectedEnd } from '../../src/rules/pace'
import type { PlanNode, PlanPhase } from '../../src/data/planV2'
import type { Ticket } from '../../src/data/types'
import { mkTicket } from '../helpers/tickets'

const NOV2 = new Date(2026, 10, 2).getTime()
const day1 = (n: number): Ticket[] => Array.from({ length: n }, (_, i) => mkTicket({ id: `t${i}`, lane: 'path', order: i, estMin: 120 }))
const B = [90, 60, 60, 60, 30, 30, 150]

describe('projectedEnd', () => {
  it('day one: 520 hours at 480 minutes a week ends in March 2028 (SET-02)', () => {
    const p = projectedEnd({ tickets: day1(260), budgets: B, careerLane: false, now: NOV2 })
    expect(p.remainingMin).toBe(31200)
    expect(p.label).toBe('March 2028')
    expect(paceLine(p)).toBe('at this pace the plan ends about March 2028')
  })
  it('raising a budget moves the date at once, lowering one moves it later and trims nothing (SET-03, SET-04)', () => {
    const base = projectedEnd({ tickets: day1(260), budgets: B, careerLane: false, now: NOV2 })
    const more = projectedEnd({ tickets: day1(260), budgets: [90, 60, 60, 60, 30, 30, 210], careerLane: false, now: NOV2 })
    const less = projectedEnd({ tickets: day1(260), budgets: [90, 60, 60, 15, 30, 30, 150], careerLane: false, now: NOV2 })
    expect(more.endMs!).toBeLessThan(base.endMs!)
    expect(more.label).toBe('January 2028')
    expect(less.endMs!).toBeGreaterThan(base.endMs!)
    expect(less.remainingMin).toBe(base.remainingMin)
  })
  it('done, archived, bank and (when off) career tickets do not count', () => {
    const t = [
      mkTicket({ id: 'a', lane: 'path', estMin: 60 }), mkTicket({ id: 'b', lane: 'path', estMin: 60, status: 'done' }),
      mkTicket({ id: 'c', lane: 'path', estMin: 60, archived: true }), mkTicket({ id: 'd', lane: 'dsa', estMin: 60, origin: 'mine' }),
      mkTicket({ id: 'e', lane: 'career', estMin: 60 }),
    ]
    expect(projectedEnd({ tickets: t, budgets: B, careerLane: false, now: NOV2 }).remainingMin).toBe(60)
    expect(projectedEnd({ tickets: t, budgets: B, careerLane: true, now: NOV2 }).remainingMin).toBe(120)
  })
  it('counts the hours of nodes in phases that are not authored yet', () => {
    const phases: PlanPhase[] = [{ p: 1, name: '', months: '', idea: '', authored: true }, { p: 2, name: '', months: '', idea: '', authored: false }]
    const node = (id: string, phase: number, hours: number, kind: PlanNode['kind'] = 'topic'): PlanNode =>
      ({ id, area: 'a', phase, kind, title: id, oneLiner: '', why: '', pre: [], explain: [], hours })
    const p = projectedEnd({ tickets: [], nodes: [node('x', 1, 9), node('y', 2, 10), node('z', 2, 5, 'band')], phases, budgets: B, careerLane: false, now: NOV2 })
    expect(p.unwrittenMin).toBe(600)
    expect(p.remainingMin).toBe(600)
  })
  it('no weekly minutes or nothing left reads as a sentence, never NaN or Infinity (Review Focus 5)', () => {
    const none = projectedEnd({ tickets: day1(3), budgets: [0, 0, 0, 0, 0, 0, 0], careerLane: false, now: NOV2 })
    expect(none).toMatchObject({ weeks: null, endMs: null, label: null })
    expect(paceLine(none)).toBe('Set a weekly budget to see when the plan ends')
    const all = projectedEnd({ tickets: [], budgets: B, careerLane: false, now: NOV2 })
    expect(paceLine(all)).toBe('Every ticket in the plan is done')
  })
})

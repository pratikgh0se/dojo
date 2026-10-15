import { describe, expect, it } from 'vitest'
import { EST_MIN, PlanDataError, idMapOf, newTicket, planToTickets, planVersionOf, tierRange } from '../../src/rules/planTickets'
import type { PlanV2 } from '../../src/data/planV2'
import { legacyForgePlan, flatPlanV2 } from '../helpers/plan'

describe('planToTickets (the flat fixture)', () => {
  it('emits every ticket once, sorted by order', () => {
    const c = planToTickets(flatPlanV2)
    expect(c.map(t => t.id).sort()).toEqual(['d-estimate', 'd-method', 'm1w1i1', 'm1w1t1', 'm1w2i1', 'm1w2t1', 'm1w3t1', 'p1', 'p127', 'p200'])
    expect(c.map(t => t.order)).toEqual([...c.map(t => t.order)].sort((a, b) => a - b))
  })

  it('maps a path ticket with its lane and kind', () => {
    const c = planToTickets(flatPlanV2)
    expect(c.find(t => t.id === 'm1w1t1')).toMatchObject({ origin: 'plan', kind: 'watch', lane: 'path' })
    expect(c.find(t => t.id === 'm1w2t1')).toMatchObject({ kind: 'build', lane: 'path' })
    expect(c.find(t => t.id === 'm1w3t1')).toMatchObject({ kind: 'read', lane: 'path' })
  })

  it('maps a problem to p<num>', () => {
    const p = planToTickets(flatPlanV2).find(t => t.id === 'p127')!
    expect(p).toMatchObject({
      id: 'p127', origin: 'plan', track: 'interview', kind: 'problem', title: '127 · Word Ladder', text: 'Graphs',
      links: [{ label: 'LeetCode 127', url: 'https://example.com/127' }],
      skill: 'dsa', pattern: 'graphs', difficulty: 'H', estMin: 30, lane: 'dsa',
    })
  })

  it('maps a design from its bank tier', () => {
    const d = planToTickets(flatPlanV2).find(t => t.id === 'd-method')!
    expect(d).toMatchObject({ kind: 'design', lane: 'design', estMin: 45, skill: 'sysd', difficulty: 'M' })
    expect(d.text).toBe('• x')
  })
})

describe('plan helpers', () => {
  it('parses tier ranges', () => {
    expect(tierRange('Foundations (sprints 21 to 24)')).toEqual([21, 24])
    expect(tierRange('No range')).toEqual([1, 72])
  })
  it('falls back for planVersion and idMap', () => {
    expect(planVersionOf(flatPlanV2)).toBe('fx-v2-1')
    expect(planVersionOf({})).toBe('unversioned')
    expect(idMapOf({})).toEqual({})
    expect(idMapOf({ ...flatPlanV2, idMap: { a: 'b' } })).toEqual({ a: 'b' })
  })
  it('reads planVersion and idMap off the frozen forge plan fixture', () => {
    expect(planVersionOf(legacyForgePlan())).toBe('forge-v0-2026-10-05')
    expect(Object.keys(idMapOf(legacyForgePlan())).length).toBe(74)
  })
  it('creates a fresh todo ticket at the planned sprint', () => {
    const c = planToTickets(flatPlanV2)[8]
    expect(newTicket(c)).toEqual({ ...c, sprint: c.plannedSprint, status: 'todo', slidFrom: [], xp: 0, archived: false })
  })
})

describe('malformed plan entries (Review Focus #2)', () => {
  const clone = (): PlanV2 => JSON.parse(JSON.stringify(flatPlanV2))

  it('rejects a ticket without an id', () => {
    const p = clone()
    ;(p.tickets[0] as { id?: string }).id = undefined
    expect(() => planToTickets(p)).toThrow(PlanDataError)
    expect(() => planToTickets(p)).toThrow('plan v2: ticket without an id')
  })
  it('rejects duplicate ids', () => {
    const p = clone()
    p.tickets[1].id = p.tickets[0].id
    expect(() => planToTickets(p)).toThrow(`duplicate id ${p.tickets[0].id}`)
  })
  it('rejects non-array links and non-numeric problem numbers', () => {
    const p = clone()
    ;(p.tickets[0] as { links: unknown }).links = 'x'
    expect(() => planToTickets(p)).toThrow('links must be an array')
    const q = clone()
    ;(q.dsa_bank[0].problems[0] as { num: unknown }).num = '200'
    expect(() => planToTickets(q)).toThrow('dsa sprint 1: problem without a numeric num')
  })
})

describe('EST_MIN defaults (spec 3.2)', () => {
  it('has the R1 estimates', () => {
    expect(EST_MIN).toMatchObject({ task: 50, problem: 30, design: 45, watch: 45, read: 40, build: 75, writeup: 60, ritual: 60 })
  })
})

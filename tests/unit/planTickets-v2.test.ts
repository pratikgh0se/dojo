import { describe, expect, it } from 'vitest'
import type { PlanV2 } from '../../src/data/planV2'
import { isPlanV2 } from '../../src/data/planV2'
import { CONTENT_KEYS, EST_MIN, PlanDataError, idMapOf, newTicket, planToTickets, planVersionOf } from '../../src/rules/planTickets'
import { flatPlanV2, smallPlanV2 } from '../helpers/plan'

const clone = (): PlanV2 => structuredClone(smallPlanV2)

describe('planToTickets, plan v2', () => {
  it('recognises both v2 fixtures and converts the flat one to ten tickets', () => {
    expect(isPlanV2(smallPlanV2)).toBe(true)
    expect(isPlanV2(flatPlanV2)).toBe(true)
    expect(planToTickets(flatPlanV2)).toHaveLength(10)
  })

  it('emits every path ticket, task, problem and design item once, sorted by order', () => {
    const c = planToTickets(smallPlanV2)
    expect(c.map(t => t.id)).toEqual([
      'ai.l1.learn', 'ai.r1.real', 'm1w1i1', 'ai.t01.learn', 'd-method', 'ai.t01.build', 'p200', 'ai.t07.learn', 'ai.b1.learn',
      'p127', 'd-estimate', 'ai.b1.build', 'p1', 'm1w2i1', 'm5w1i1', 'm9w1i1',
    ])
    expect(c.map(t => t.order)).toEqual([...c.map(t => t.order)].sort((a, b) => a - b))
    expect(new Set(c.map(t => t.order)).size).toBe(c.length)
  })

  it('maps a path ticket with its lane, node, area, phase, lab, explain and asOf', () => {
    expect(planToTickets(smallPlanV2).find(t => t.id === 'ai.t01.build')).toEqual({
      id: 'ai.t01.build', origin: 'plan', track: 'ai', kind: 'build', title: 'Write a roofline calculator',
      text: 'Write a roofline calculator.\nDone when it works.', links: [{ label: 'Ref', url: 'https://example.com/ref' }], estMin: 60,
      order: smallPlanV2.tickets.find(t => t.id === 'ai.t01.build')!.order, plannedSprint: 1,
      lane: 'path', node: 'T01', area: 'llm', phase: 1, explain: ['Explain Memory and compute bounds?'], explainAnswers: ['The short answer for T01. It has two sentences.'], lab: { id: 'b1', gpu: 'none' }, asOf: '2026-10-11',
    })
  })

  it('maps tasks, problems and designs with their lane, skill and fixed estimates', () => {
    const c = planToTickets(smallPlanV2)
    expect(c.find(t => t.id === 'm1w1i1')).toMatchObject({ track: 'interview', kind: 'task', lane: 'dsa', skill: 'dsa', estMin: 50 })
    expect(c.find(t => t.id === 'm9w1i1')).toMatchObject({ lane: 'career', skill: 'loops' })
    expect(c.find(t => t.id === 'p127')).toMatchObject({
      kind: 'problem', lane: 'dsa', title: '127 · Word Ladder', text: 'Graphs: BFS and DFS', skill: 'dsa', difficulty: 'H',
      pattern: 'Graphs; Island (Matrix Traversal)', estMin: EST_MIN.problem, links: [{ label: 'LeetCode 127', url: 'https://leetcode.com/problems/word-ladder/' }],
    })
    expect(c.find(t => t.id === 'd-method')).toMatchObject({ kind: 'design', lane: 'design', skill: 'sysd', estMin: EST_MIN.design, text: '• Requirements\n• API first\n• One deep dive\n• Failure modes' })
  })

  it('gives legacy readers a plannedSprint: the 14-day window (twice the weekly budgets) a ticket starts in, capped at 72', () => {
    const p = clone()
    p.tickets[0].estMin = 120
    p.tickets[1].estMin = 120
    const windowMin = 2 * p.mix.budgets.reduce((a, b) => a + b, 0)
    expect(windowMin).toBe(960)
    p.tasks.forEach(t => { t.estMin = 120 })
    const rows = planToTickets(p)
    expect(rows[0].plannedSprint).toBe(1)
    const total = rows.reduce((a, r) => a + r.estMin, 0)
    expect(rows[rows.length - 1].plannedSprint).toBe(Math.min(72, 1 + Math.floor((total - rows[rows.length - 1].estMin) / windowMin)))
    p.mix.budgets = [1, 0, 0, 0, 0, 0, 0]
    expect(planToTickets(p).at(-1)!.plannedSprint).toBe(72)
  })

  it('refuses a malformed plan instead of seeding part of it', () => {
    const dup = clone(); dup.tasks[0].id = 'ai.l1.learn'
    expect(() => planToTickets(dup)).toThrow(PlanDataError)
    const noOrder = clone(); delete (noOrder.dsa_bank[0].problems[0] as { order?: number }).order
    expect(() => planToTickets(noOrder)).toThrow(/order must be a number/)
    const badLinks = clone(); (badLinks.tickets[0] as { links: unknown }).links = 'x'
    expect(() => planToTickets(badLinks)).toThrow(/links must be an array/)
    const zero = clone(); badLinks.tickets[0].links = []; zero.tickets[0].estMin = 0
    expect(() => planToTickets(zero)).toThrow(/estMin/)
  })

  it('reads planVersion and idMap off a v2 plan', () => {
    expect(planVersionOf(smallPlanV2)).toBe('fx-v2-2026-10-12')
    expect(idMapOf({ ...smallPlanV2, idMap: { a: 'b' } })).toEqual({ a: 'b' })
  })

  it('refreshes the new content keys on a reconcile', () => {
    for (const k of ['lane', 'node', 'area', 'phase', 'explain', 'explainAnswers', 'lab', 'asOf']) expect(CONTENT_KEYS).toContain(k)
    // learner-owned fields must never be refreshed by a reconcile
    for (const k of ['learnerNotes', 'explainResponses', 'selfMark', 'orderOverride']) expect(CONTENT_KEYS).not.toContain(k)
    for (const k of ['order', 'explain', 'explainAnswers']) expect(CONTENT_KEYS).toContain(k)
  })

  it('creates a todo ticket carrying the v2 fields', () => {
    const c = planToTickets(smallPlanV2).find(t => t.id === 'ai.r1.real')!
    expect(newTicket(c)).toMatchObject({ status: 'todo', xp: 0, archived: false, lane: 'path', node: 'R1', sprint: c.plannedSprint })
  })
})

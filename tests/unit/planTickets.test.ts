import { describe, expect, it } from 'vitest'
import {
  PlanDataError, idMapOf, isPlanJson, newTicket, planToTickets, planVersionOf, tierRange, titleFromText,
} from '../../src/rules/planTickets'
import type { PlanJson } from '../../src/data/types'
import { legacyPlan, realPlan, smallPlan } from '../helpers/plan'

describe('planToTickets', () => {
  it('emits tasks, then problems, then designs, in plan order', () => {
    const c = planToTickets(smallPlan)
    expect(c.map(t => t.id)).toEqual([
      'm1w1t1', 'm1w1i1', 'm1w2t1', 'm1w2i1', 'm1w3t1', 'p200', 'p127', 'p1', 'd-method', 'd-estimate',
    ])
    expect(c.map(t => t.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('maps a task', () => {
    const t = planToTickets(smallPlan)[0]
    expect(t).toEqual({
      id: 'm1w1t1', origin: 'plan', track: 'ai', kind: 'task', title: 'Rung 1, the API call',
      text: 'Rung 1, the API call. Watch the course, then build a CLI',
      links: [{ label: 'Anthropic Academy: Claude with the Anthropic API (free)', url: 'https://example.com/academy' }],
      skill: 'aieng', estMin: 50, plannedSprint: 1, order: 0,
    })
    expect(planToTickets(smallPlan)[1]).toMatchObject({ id: 'm1w1i1', track: 'interview', kind: 'task' })
  })

  it('keeps a plan task tagged watch or read as a learning card (briefs Addendum 1 Q1)', () => {
    const plan = structuredClone(smallPlan)
    plan.sprints[0].interview[0].kind = 'watch'
    plan.sprints[0].ai[0].kind = 'read'
    const c = planToTickets(plan)
    expect(c.find(t => t.id === 'm1w1i1')).toMatchObject({ kind: 'watch', estMin: 50 })
    expect(c.find(t => t.id === 'm1w1t1')).toMatchObject({ kind: 'read', estMin: 50 })
    expect(c.find(t => t.id === 'm1w2t1')!.kind).toBe('task')
  })

  it('maps a problem to p<num>', () => {
    const p = planToTickets(smallPlan).find(t => t.id === 'p127')!
    expect(p).toEqual({
      id: 'p127', origin: 'plan', track: 'interview', kind: 'problem', title: '127 · Word Ladder',
      text: 'Graphs: BFS and DFS',
      links: [{ label: 'LeetCode 127', url: 'https://leetcode.com/problems/word-ladder/' }],
      skill: 'dsa', pattern: 'Graphs; Island (Matrix Traversal)', difficulty: 'H', estMin: 30, plannedSprint: 1, order: 6,
    })
  })

  it('spreads designs across the tier sprint range', () => {
    const c = planToTickets(smallPlan)
    expect(c.find(t => t.id === 'd-method')).toMatchObject({ kind: 'design', plannedSprint: 2, estMin: 45, skill: 'sysd', difficulty: 'M' })
    expect(c.find(t => t.id === 'd-estimate')).toMatchObject({ plannedSprint: 3 })
    expect(c.find(t => t.id === 'd-method')!.text).toBe('• Requirements\n• API first\n• One deep dive\n• Failure modes')
  })

  it('covers the frozen pre-forge plan: 316 tasks + 169 problems + 48 designs, unique ids', () => {
    const c = planToTickets(legacyPlan())
    expect(c).toHaveLength(533)
    expect(new Set(c.map(t => t.id)).size).toBe(533)
    expect(c.filter(t => t.kind === 'problem')).toHaveLength(169)
    expect(c.filter(t => t.kind === 'design')).toHaveLength(48)
    expect(c.find(t => t.id === 'd-method')!.plannedSprint).toBe(21)
    expect(c.some(t => t.title.endsWith('…'))).toBe(false) // UAT cu-3 P3-8: no title is cut in the data
  })

  it('covers the live capstone plan: 145 tasks + 169 problems + 48 designs + 288 stage tickets, unique ids', () => {
    const c = planToTickets(realPlan())
    expect(c).toHaveLength(650)
    expect(new Set(c.map(t => t.id)).size).toBe(650)
    expect(c.filter(t => t.kind === 'task')).toHaveLength(145)
    expect(c.filter(t => t.kind === 'problem')).toHaveLength(169)
    expect(c.filter(t => t.kind === 'design')).toHaveLength(48)
    expect(c.filter(t => t.kind === 'stage')).toHaveLength(288)
    expect(c.some(t => t.title.endsWith('…'))).toBe(false) // UAT cu-3 P3-8: no title is cut in the data
  })
})

describe('plan helpers', () => {
  it('builds titles from the first sentence, whole: the data never cuts a title with "…" (UAT cu-3 P3-8)', () => {
    expect(titleFromText('Set the routine: 25 minutes per problem')).toBe('Set the routine: 25 minutes per problem')
    const long = 'NumPy drill: 20 small exercises on indexing, broadcasting, matmul, without loops'
    expect(titleFromText(long)).toBe(long)
    expect(titleFromText(`${long}. A second sentence stays in the task text.`)).toBe(long)
    const routine = 'Set the routine: 25 minutes per problem, no hints until time is up; then study the best solution and re-solve from blank the next day. Log time and mistakes in the vault'
    expect(titleFromText(routine)).toBe('Set the routine: 25 minutes per problem, no hints until time is up; then study the best solution and re-solve from blank the next day')
  })
  it('parses tier ranges', () => {
    expect(tierRange('Foundations (sprints 21 to 24)')).toEqual([21, 24])
    expect(tierRange('No range')).toEqual([1, 72])
  })
  it('falls back for planVersion and idMap (frozen pre-forge plan has neither)', () => {
    expect(planVersionOf(smallPlan)).toBe('fx-1')
    expect(planVersionOf(legacyPlan())).toBe('2026-09-05')
    expect(idMapOf(legacyPlan())).toEqual({})
    expect(idMapOf({ ...smallPlan, idMap: { a: 'b' } })).toEqual({ a: 'b' })
  })
  it('reads planVersion and idMap off the live capstone plan', () => {
    expect(planVersionOf(realPlan())).toBe('forge-v0-2026-10-05')
    expect(Object.keys(idMapOf(realPlan())).length).toBe(74)
  })
  it('recognises a plan shape', () => {
    expect(isPlanJson(smallPlan)).toBe(true)
    expect(isPlanJson({ sprints: [] })).toBe(false)
    expect(isPlanJson('x')).toBe(false)
  })
  it('creates a fresh todo ticket at the planned sprint', () => {
    const c = planToTickets(smallPlan)[8]
    expect(newTicket(c)).toEqual({ ...c, sprint: 2, status: 'todo', slidFrom: [], xp: 0, archived: false })
  })
})

describe('stage items', () => {
  it('converts an AI-track task with kind:stage to a stage ticket', () => {
    const plan: PlanJson = {
      generated: '2026-09-05',
      planVersion: 'test-1',
      sprint_days: 14,
      total_sprints: 72,
      rotation: {},
      sprints: [
        {
          sprint: 1, block: 1, block_title: 'B1', block_theme: 'T1', focus_ai: 'fa1', focus_interview: 'fi1', proof: null,
          ai: [
            { id: 'stage-1', skill: 'meta', text: 'Reflect on progress', links: [] } as any,
          ],
          interview: [],
        },
      ],
      dsa_bank: [],
      design_bank: [],
    }
    ;(plan.sprints[0].ai[0] as any).kind = 'stage'
    const c = planToTickets(plan)
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ id: 'stage-1', kind: 'stage', estMin: 50 })
  })
})

describe('malformed plan entries (Review Focus #2)', () => {
  const clone = (): PlanJson => JSON.parse(JSON.stringify(smallPlan))

  it('rejects a task without an id', () => {
    const p = clone()
    ;(p.sprints[0].ai[0] as { id?: string }).id = undefined
    expect(() => planToTickets(p)).toThrow(PlanDataError)
    expect(() => planToTickets(p)).toThrow('sprint 1: task without an id')
  })
  it('rejects duplicate ids', () => {
    const p = clone()
    p.sprints[1].ai[0].id = 'm1w1t1'
    expect(() => planToTickets(p)).toThrow('duplicate id m1w1t1')
  })
  it('rejects non-array links and non-numeric problem numbers', () => {
    const p = clone()
    ;(p.sprints[0].interview[0] as { links: unknown }).links = 'x'
    expect(() => planToTickets(p)).toThrow('m1w1i1: links must be an array')
    const q = clone()
    ;(q.dsa_bank[0].problems[0] as { num: unknown }).num = '200'
    expect(() => planToTickets(q)).toThrow('dsa sprint 1: problem without a numeric num')
  })
})

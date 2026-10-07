import { describe, expect, it } from 'vitest'
import { SKILL_TIERS, tierName } from '../../src/content/skillTiers'
import type { PlanSkill, Ticket } from '../../src/data/types'
import {
  journey, skillGates, skillProgress, skillSprints, skillStates, skillTreeLayout, sprintPath, sprintView, UNLOCK_AT,
} from '../../src/rules/map'
import { newTicket, planToTickets } from '../../src/rules/planTickets'
import { realPlan } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'

const sk = (id: string, needs: string[] = [], tier = 0): PlanSkill => ({ id, label: id.toUpperCase(), tier, needs, what: `${id} what`, why: `${id} why` })
const tk = (skill: string, n: number, done: number): Ticket[] =>
  Array.from({ length: n }, (_, i) => mkTicket({ id: `${skill}-${i}`, skill, status: i < done ? 'done' : 'todo' }))
const run = (skills: PlanSkill[], tickets: Ticket[]) => {
  const p = skillProgress(skills, tickets)
  return { p, states: skillStates(skills, p), gates: skillGates(skills, p) }
}
const plan = realPlan()
const fresh = () => planToTickets(plan).map(newTicket)

describe('skillProgress', () => {
  it('counts non-archived tickets per skill; zero-ticket skills are 0%; unknown skills ignored', () => {
    const ts = [...tk('a', 4, 2), mkTicket({ id: 'arch', skill: 'a', status: 'done', archived: true }), mkTicket({ id: 'z', skill: 'zzz' })]
    const p = skillProgress([sk('a'), sk('b')], ts)
    expect(p).toEqual({ a: { done: 2, total: 4, pct: 0.5 }, b: { done: 0, total: 0, pct: 0 } })
  })
})

describe('skillStates: the 70% rule (Review Focus #4)', () => {
  const skills = [sk('p'), sk('c', ['p'], 1)]
  it('69% keeps the child locked; 70% unlocks it', () => {
    expect(UNLOCK_AT).toBe(0.7)
    expect(run(skills, tk('p', 100, 69)).states.c).toBe('locked')
    expect(run(skills, tk('p', 100, 70)).states.c).toBe('open')
    expect(run(skills, [...tk('p', 100, 70), ...tk('c', 2, 1)]).states.c).toBe('active')
    expect(run(skills, tk('p', 100, 70)).states.p).toBe('active')
  })
  it('done is 100% even under a locked parent', () => {
    expect(run(skills, [...tk('p', 10, 0), ...tk('c', 3, 3)]).states.c).toBe('done')
  })
  it('a zero-ticket skill is 0% and open or locked by its parents only', () => {
    const s = [sk('p'), sk('z'), sk('z2', ['p'], 1)]
    const { p, states } = run(s, tk('p', 10, 0))
    expect(p.z).toEqual({ done: 0, total: 0, pct: 0 })
    expect(states.z).toBe('open')
    expect(states.z2).toBe('locked')
  })
  it('a zero-ticket parent does not lock its children forever', () => {
    expect(run([sk('z'), sk('c', ['z'], 1)], tk('c', 5, 0)).states.c).toBe('open')
  })
  it('a lock propagates through a zero-ticket parent', () => {
    const s = [sk('p'), sk('z', ['p'], 1), sk('c', ['z'], 2)]
    const { states } = run(s, [...tk('p', 10, 0), ...tk('c', 5, 0)])
    expect(states.z).toBe('locked')
    expect(states.c).toBe('locked')
  })
  it('locks propagate down a ticketed chain', () => {
    const s = [sk('a'), sk('b', ['a'], 1), sk('c', ['b'], 2)]
    const { states } = run(s, [...tk('a', 10, 5), ...tk('b', 2, 0), ...tk('c', 2, 0)])
    expect(states).toEqual({ a: 'active', b: 'locked', c: 'locked' })
  })
  it('gates (orange edges) open at 70%, stay closed at 69%', () => {
    expect(run(skills, tk('p', 100, 70)).gates.p).toBe(true)
    expect(run(skills, tk('p', 100, 69)).gates.p).toBe(false)
  })
  it('a cyclic needs graph terminates and locks both sides (A needs B, B needs A)', () => {
    const s = [sk('a', ['b']), sk('b', ['a'])]
    const { states } = run(s, [])
    expect(states).toEqual({ a: 'locked', b: 'locked' })
  })
  it('runs on the live plan with no progress', () => {
    const skills = plan.skills!
    const { states } = run(skills, fresh())
    expect(Object.keys(states)).toHaveLength(28)
    expect(states.py).toBe('open')
    expect(states.calc).toBe('open')
    expect(states.dsa).toBe('open')
    expect(states.aieng).toBe('open')
    expect(states.ml).toBe('locked')
  })
})

describe('skillTreeLayout', () => {
  it('puts nodes in tier columns, rows in file order, edges from needs', () => {
    const { nodes, edges } = skillTreeLayout([sk('a', [], 0), sk('b', [], 0), sk('c', ['a', 'ghost'], 1)])
    expect(nodes).toEqual([{ id: 'a', col: 0, row: 0 }, { id: 'b', col: 0, row: 1 }, { id: 'c', col: 1, row: 0 }])
    expect(edges).toEqual([{ from: 'a', to: 'c' }])
  })
  it('lays out all 28 live skills across tiers 0–8', () => {
    const { nodes, edges } = skillTreeLayout(plan.skills!)
    expect(nodes).toHaveLength(28)
    expect(Math.max(...nodes.map(n => n.col))).toBe(8)
    expect(edges).toHaveLength(plan.skills!.reduce((a, s) => a + s.needs.length, 0))
  })
  it('names tiers from extra.json', () => {
    expect(SKILL_TIERS).toHaveLength(9)
    expect(tierName(0)).toBe('Math + tools')
    expect(tierName(8)).toBe('Apply')
    expect(tierName(12)).toBe('Tier 12')
  })
})

describe('journey (Review Focus #5)', () => {
  it('maps phase months (blocks) to sprints', () => {
    const j = journey(plan.phases!, 9)
    expect(j.map(s => [s.n, s.firstSprint, s.lastSprint])).toEqual([
      ['Foundations', 1, 8], ['Neural nets', 9, 16], ['The LLM stack', 17, 24], ['Systems at scale', 25, 32],
      ['Evals + research', 33, 40], ['Ship + apply', 41, 48], ['Interview season', 49, 60], ['Loops + offers', 61, 72],
    ])
    expect(j.map(s => s.state).slice(0, 3)).toEqual(['done', 'current', 'upcoming'])
  })
  it('is all upcoming before start and all done after S72', () => {
    expect(journey(plan.phases!, 0).every(s => s.state === 'upcoming')).toBe(true)
    expect(journey(plan.phases!, 73).every(s => s.state === 'done')).toBe(true)
    expect(journey([], 5)).toEqual([])
  })
})

describe('sprintPath', () => {
  it('groups consecutive sprints sharing a block_title into one row (these are the capstone stages)', () => {
    const ts = fresh()
    const path = sprintPath(plan, ts, 1)
    expect(path).toHaveLength(12)
    expect(path[0]).toMatchObject({ from: 1, to: 1, title: 'Forge begins: math you can picture' })
    expect(path[0].sprints.map(s => s.sprint)).toEqual([1])
    expect(path[0].sprints[0].cubes).toHaveLength(ts.filter(t => t.sprint === 1).length)
    expect(path[0].sprints[0]).toMatchObject({ current: true, cleared: false })
    expect(path[1]).toMatchObject({ from: 2, to: 4, title: 'Autograd from scratch' })
    expect(path[1].sprints.map(s => s.sprint)).toEqual([2, 3, 4])
  })
  it('clears a sprint when every homed ticket is done; archived tickets excluded; slides move cubes', () => {
    const ts = fresh()
    const s1 = ts.filter(t => t.sprint === 1).map(t => t.id)
    const done = ts.map(t => (s1.includes(t.id) ? { ...t, status: 'done' as const } : t))
    expect(sprintPath(plan, done, 2)[0].sprints[0].cleared).toBe(true)
    const slid = ts.map(t => (t.id === s1[0] ? { ...t, sprint: 2, slidFrom: [1] } : t.id === s1[1] ? { ...t, archived: true } : t))
    const row = sprintPath(plan, slid, 1)
    expect(row[0].sprints[0].cubes).toHaveLength(s1.length - 2)
    expect(row[1].sprints[0].cubes).toHaveLength(ts.filter(t => t.sprint === 2).length + 1)
  })
  it('extends past the plan when a live ticket has slid beyond the last plan sprint (empty sprints get no title match)', () => {
    const ts = [...fresh(), mkTicket({ id: 'slid-far', skill: 'nn', sprint: 74, status: 'todo' })]
    const path = sprintPath(plan, ts, 1, 74)
    const last = path[path.length - 1]
    expect(last.from).toBe(73)
    expect(last.to).toBe(74)
    expect(last.title).toBe('No plan data')
    expect(last.sprints.map(s => s.sprint)).toEqual([73, 74])
    expect(last.sprints[1].cubes).toHaveLength(1)
  })
})

describe('sprintView and skillSprints', () => {
  it('shows a sprint’s focus, both ticket lists and proof', () => {
    const ts = fresh()
    const v = sprintView(plan, ts, 1)!
    expect(v).toMatchObject({ sprint: 1, block: 1, focusAi: 'Stage 00: Setup + math by picture', focusInterview: 'Graphs: BFS and DFS', proof: null })
    expect(v.ai.map(t => t.id)).toEqual(['stage-00-setup-w1-watch', 'stage-00-setup-w1-rebuild', 'stage-00-setup-w1-build', 'stage-00-setup-w1-teachback'])
    expect(v.interview.every(t => t.track === 'interview')).toBe(true)
    expect(sprintView(plan, ts, 4)!.proof).toMatch(/^A public repo `math-notes`/)
    expect(sprintView(plan, ts, 99)).toBeNull()
  })
  it('lists the sprints where a skill’s live tickets are homed', () => {
    expect(skillSprints('calc', fresh())).toEqual([1])
    expect(skillSprints('nope', fresh())).toEqual([])
  })
})

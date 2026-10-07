import { describe, expect, it } from 'vitest'
import { APPROACHES } from '../../src/content/approaches'
import { PATTERNS } from '../../src/content/atlas'
import type { Session } from '../../src/data/types'
import { AVOID_MIN_BEST, approachCoverage } from '../../src/rules/approachCoverage'
import { problemsByPattern, problemsLeft, rowMatches, sortRows } from '../../src/rules/atlasRows'
import { realPlan } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'

const plan = realPlan()
const t = (num: number, done = false) => mkTicket({ id: `p${num}`, kind: 'problem', track: 'interview', status: done ? 'done' : 'todo' })
const S = (ticketId: string, approach: string | undefined, id: string, outcome: Session['outcome'] = 'solved'): Session =>
  ({ id, ticketId, start: 0, end: 1, minutes: 20, outcome, xpDelta: 0, ...(approach ? { approach } : {}) })

describe('approach coverage (§5.6, D-15)', () => {
  it('counts best and used per answered solved session; Other counts for no row (S43, S44)', () => {
    expect(AVOID_MIN_BEST).toBe(2)
    const one = approachCoverage([S('p743', 'dijkstra', 's1')], APPROACHES)
    expect(one['shortest-path']).toEqual({ used: 1, best: 1, state: 'ok' })
    const c = approachCoverage([S('p743', 'other', 's1'), S('p1514', 'other', 's2'), S('p215', 'heap', 's3', 'solved_help')], APPROACHES)
    expect(c['shortest-path']).toEqual({ used: 0, best: 2, state: 'avoided' })
    expect(c['heap-pq']).toEqual({ used: 1, best: 0, state: 'ok' })
    expect(c.sorting).toEqual({ used: 0, best: 1, state: 'ok' })
    expect(c.mst).toEqual({ used: 0, best: 0, state: 'none' })
  })

  it('ignores give-ups, unanswered sessions and problems without approaches', () => {
    const c = approachCoverage([S('p743', 'dijkstra', 's1', 'gave_up'), S('p743', undefined, 's2'), S('p1', 'x', 's3')], APPROACHES)
    expect(c['shortest-path']).toEqual({ used: 0, best: 0, state: 'none' })
  })
})

describe('Atlas rows (§5.2–5.4)', () => {
  it('tags each plan problem on every row its approaches use; Left counts the unsolved ones', () => {
    const tagged = problemsByPattern(plan, [t(207, true)], APPROACHES)
    expect(tagged['topo-sort'].find(p => p.id === 'p207')).toMatchObject({ num: 207, name: 'Course Schedule', sprint: 2, solved: true })
    expect(tagged['shortest-path'].map(p => p.id)).toContain('p743')
    expect(problemsLeft(tagged['topo-sort'])).toBe(tagged['topo-sort'].length - 1)
  })

  it('sorts by Left descending, prototype order breaking ties (S8)', () => {
    const tagged = problemsByPattern(plan, [], APPROACHES)
    const rows = sortRows('left', tagged)
    const lefts = rows.map(p => problemsLeft(tagged[p.slug]))
    expect(lefts).toEqual([...lefts].sort((a, b) => b - a))
    for (let i = 1; i < rows.length; i++) {
      if (lefts[i] === lefts[i - 1]) expect(PATTERNS.indexOf(rows[i])).toBeGreaterThan(PATTERNS.indexOf(rows[i - 1]))
    }
    expect(sortRows('map', tagged).map(p => p.slug)).toEqual(PATTERNS.map(p => p.slug))
  })

  it('filters by label, LeetCode number or problem name (S9, S10, S11)', () => {
    const tagged = problemsByPattern(plan, [], APPROACHES)
    const visible = (q: string) => PATTERNS.filter(p => rowMatches(p, q, tagged)).map(p => p.label)
    expect(visible('dp')).toEqual(['DP · memo', 'DP · tabulation', 'DP · bitmask'])
    expect(visible('743')).toContain('Shortest path')
    expect(visible('course sched')).toEqual(expect.arrayContaining(['BFS / DFS', 'Topo sort']))
    expect(visible('shortest path with k stops across flights zzz')).toEqual([])
    expect(visible('  ')).toHaveLength(36)
  })
})

import { describe, expect, it } from 'vitest'
import { APPROACHES, approachesFor, chipName } from '../../src/content/approaches'
import { patternBySlug, walkDef } from '../../src/content/atlas'
import { realPlan } from '../helpers/plan'

const pinned = (id: string) => approachesFor(id).map(a => [a.name, a.complexity, patternBySlug(a.pattern)!.label, a.libraryKey ?? null, a.best])

describe('approaches (TRACKING §3; labs contract §2.4)', () => {
  it('covers exactly the 169 plan problems', () => {
    const ids = realPlan().dsa_bank.flatMap(w => w.problems.map(p => `p${p.num}`))
    expect(ids).toHaveLength(169)
    expect(Object.keys(APPROACHES).sort()).toEqual([...ids].sort())
  })

  it.each(Object.entries(APPROACHES))('%s: 2–4 ways, brute → best, one star last, names ≤ 4 words, a real row and key', (_id, list) => {
    expect(list.length).toBeGreaterThanOrEqual(2)
    expect(list.length).toBeLessThanOrEqual(4)
    expect(list.map(a => a.best)).toEqual(list.map((_, i) => i === list.length - 1))
    expect(new Set(list.map(a => a.id)).size).toBe(list.length)
    for (const a of list) {
      expect(a.name.split(' ').length, a.name).toBeLessThanOrEqual(4)
      expect(a.complexity, a.name).toMatch(/^O\(/)
      expect(patternBySlug(a.pattern), a.pattern).toBeDefined()
      if (a.libraryKey) expect(walkDef(a.libraryKey), a.libraryKey).toBeDefined()
      expect(a.id).not.toBe('other')
    }
  })

  it('pins the five approach lists the contract tests use', () => {
    expect(pinned('p743')).toEqual([['Bellman-Ford', 'O(V·E)', 'Shortest path', 'bellmanFord', false], ['Dijkstra', 'O(E log V)', 'Shortest path', 'dijkstra', true]])
    expect(pinned('p1514')).toEqual([['Bellman-Ford', 'O(V·E)', 'Shortest path', 'bellmanFord', false], ['Dijkstra max-heap', 'O(E log V)', 'Shortest path', 'dijkstra', true]])
    expect(pinned('p215')).toEqual([
      ['Sort', 'O(n log n)', 'Sorting', 'quickSort', false], ['Min-heap of size k', 'O(n log k)', 'Heap / PQ', 'heapPush', false], ['Quickselect', 'O(n) avg', 'Sorting', 'quickSort', true],
    ])
    expect(pinned('p207')).toEqual([['DFS cycle check', 'O(V+E)', 'BFS / DFS', 'dfs', false], ['Kahn topo sort', 'O(V+E)', 'Topo sort', 'topoSort', true]])
    expect(pinned('p322')).toEqual([
      ['Brute recursion', 'O(c^a)', 'Backtracking', null, false], ['Memoization', 'O(a·c)', 'DP · memo', 'memo', false], ['Tabulation', 'O(a·c)', 'DP · tabulation', 'coinChange', true],
    ])
    expect(approachesFor('p743').map(chipName)).toEqual(['Bellman-Ford · O(V·E)', 'Dijkstra · O(E log V) · best'])
    expect(approachesFor('p99999')).toEqual([])
  })
})

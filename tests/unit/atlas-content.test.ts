import { beforeAll, describe, expect, it } from 'vitest'
import {
  ATOMS, PATTERNS, TOPIC_WARMUPS, WALKTHROUGHS, atlasRowOf, kebab, patternByLabel, patternsOfWalk, twoUpPartner, walkDef,
} from '../../src/content/atlas'
import { resolveWalk, type AlgoGlobals } from '../../src/rules/walkthrough'
import { installAlgoEngines } from '../helpers/engines'
import { realPlan } from '../helpers/plan'

const g = () => window as unknown as AlgoGlobals
type ProtoMap = { cols: string[]; rows: { label: string; cells: ('ok' | 'run' | 'skip')[] }[] }

const SLUGS = [
  'two-pointers', 'sliding-window', 'prefix-sum', 'binary-search', 'sorting', 'greedy', 'backtracking', 'dp-memo', 'dp-tabulation',
  'dp-bitmask', 'bfs-dfs', 'shortest-path', 'mst', 'topo-sort', 'union-find', 'heap-pq', 'trie', 'segment-fenwick', 'monotonic-stack',
  'bit-tricks', 'number-theory', 'geometry', 'game-theory', 'streaming', 'string-match', 'divide-conquer', 'all-pairs-paths',
  'cycle-fast-slow', 'scc-bridges', 'flow-matching', 'lru-design', 'combinatorics', 'probability', 'sweep-line', 'simulation', 'sieve-primes',
]

describe('Atlas content (labs contract §2)', () => {
  beforeAll(installAlgoEngines)

  it('has the prototype map: 16 atoms and 36 rows in order, same main and side atoms, the contract slugs', () => {
    const proto = JSON.parse(g().SRAtlas!.map as string) as ProtoMap
    expect([...ATOMS]).toEqual(proto.cols)
    expect(PATTERNS.map(p => p.label.toUpperCase())).toEqual(proto.rows.map(r => r.label))
    for (const [i, p] of PATTERNS.entries()) {
      const cells = proto.rows[i].cells
      expect([...p.main].sort(), p.label).toEqual(ATOMS.filter((_, j) => cells[j] === 'ok').sort())
      expect([...p.side].sort(), p.label).toEqual(ATOMS.filter((_, j) => cells[j] === 'run').sort())
    }
    expect(PATTERNS.map(p => p.slug)).toEqual(SLUGS)
  })

  it('keeps the nine rows without a walkthrough honest (D-3)', () => {
    expect(PATTERNS.filter(p => p.walkthroughs.length === 0).map(p => p.slug)).toEqual([
      'prefix-sum', 'dp-bitmask', 'trie', 'segment-fenwick', 'string-match', 'scc-bridges', 'flow-matching', 'combinatorics', 'simulation',
    ])
    expect(PATTERNS.find(p => p.slug === 'flow-matching')).toMatchObject({ status: 'gap', how: 'edge labels show one number; needs cap/flow pairs' })
  })

  it('has 45 walkthroughs whose title and complexity are what the engine header shows', () => {
    expect(WALKTHROUGHS).toHaveLength(45)
    expect(WALKTHROUGHS.filter(w => w.source === 'library').map(w => w.key).sort()).toEqual(Object.keys(g().SRAlgo!.library).sort())
    for (const w of WALKTHROUGHS) {
      const r = resolveWalk(w.key, undefined, g())
      expect(r.ok, w.key).toBe(true)
      if (r.ok) expect([r.json.title, r.json.complexity], w.key).toEqual([w.title, w.complexity])
      expect(!!w.input, w.key).toBe(w.source === 'library')
    }
    for (const k of [...PATTERNS.flatMap(p => p.walkthroughs), ...Object.values(TOPIC_WARMUPS).flat()]) expect(walkDef(k), k).toBeDefined()
  })

  it('reports errors instead of throwing', () => {
    expect(resolveWalk('nope', undefined, g())).toEqual({ ok: false, error: 'No walkthrough "nope"' })
    expect(resolveWalk('bfs', undefined, {})).toEqual({ ok: false, error: 'The algorithm engine is not loaded' })
    expect(resolveWalk('memo', undefined, {})).toEqual({ ok: false, error: 'The Atlas pieces are not loaded' })
  })

  it('opens every DSA topic sprint of the live plan with a warm-up (§2.3)', () => {
    const sprints = realPlan().dsa_bank.map(w => w.sprint).sort((a, b) => a - b)
    expect(Object.keys(TOPIC_WARMUPS).map(Number).sort((a, b) => a - b)).toEqual(sprints)
    expect(TOPIC_WARMUPS[1]).toEqual(['bfsGrid', 'islands', 'bfs', 'dfs'])
    expect(TOPIC_WARMUPS[7]).toEqual(['memo', 'tab', 'coinChange', 'lis'])
  })

  it('credits every row that lists a walkthrough (D-4) and pairs Two-up (D-9)', () => {
    expect(patternsOfWalk('mergeSort')).toEqual(['sorting', 'divide-conquer'])
    expect(patternsOfWalk('sieve')).toEqual(['number-theory', 'sieve-primes'])
    expect(twoUpPartner('memo', 'dp-memo')).toBe('tab')
    expect(twoUpPartner('dijkstra', 'shortest-path')).toBe('bellmanFord')
    expect(twoUpPartner('binarySearch', 'binary-search')).toBe('bsAnswer')
    expect(twoUpPartner('kadane', 'dp-tabulation')).toBe('tab')
    expect(twoUpPartner('kruskal', 'mst')).toBeNull()
    expect(patternByLabel('SLIDING WINDOW')?.slug).toBe('sliding-window')
    expect(kebab('binarySearch')).toBe('binary-search')
    expect(kebab('dijkstra')).toBe('dijkstra')
    expect(WALKTHROUGHS.filter(w => patternsOfWalk(w.key).length === 0).map(w => w.key)).toEqual(['bstInsert'])
    for (const k of Object.values(TOPIC_WARMUPS).flat()) expect(atlasRowOf(k), k).toBeDefined()
    expect(atlasRowOf('bstInsert')).toBe('bfs-dfs')
  })
})

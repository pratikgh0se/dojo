import { beforeAll, describe, expect, it } from 'vitest'
import { WALKTHROUGHS } from '../../src/content/atlas'
import { INPUT_DEFAULTS, INPUT_FIELDS } from '../../src/content/libraryInputs'
import { parseOwnInput } from '../../src/rules/ownInput'
import { resolveWalk, type AlgoGlobals } from '../../src/rules/walkthrough'
import { installAlgoEngines } from '../helpers/engines'

const g = () => window as unknown as AlgoGlobals
const RUNNABLE = WALKTHROUGHS.filter(w => w.input).map(w => w.key)
const parse = (key: string, patch: Record<string, string> = {}) => parseOwnInput(key, { ...INPUT_DEFAULTS[key], ...patch })
const err = (key: string, patch: Record<string, string>) => {
  const r = parse(key, patch)
  return r.ok ? 'ok' : `${r.field}: ${r.error}`
}

describe('own input (labs contract §4.6, D-10)', () => {
  beforeAll(installAlgoEngines)

  it('has default text for every runnable entry, one field per kind label', () => {
    expect(Object.keys(INPUT_DEFAULTS).sort()).toEqual([...RUNNABLE].sort())
    for (const key of RUNNABLE) {
      const kind = WALKTHROUGHS.find(w => w.key === key)!.input!
      expect(Object.keys(INPUT_DEFAULTS[key]).sort(), key).toEqual(INPUT_FIELDS[kind].map(f => f.name).sort())
    }
  })

  it.each(RUNNABLE)('%s: the default text runs with as many steps as the engine default', key => {
    const r = parse(key)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const mine = resolveWalk(key, r.value, g())
    const base = resolveWalk(key, undefined, g())
    expect(mine.ok && base.ok && mine.json.steps.length).toBe(base.ok && base.json.steps.length)
  })

  it('traces the contract inputs', () => {
    const bs = parse('binarySearch', { values: '1,3,5,7,9', target: '7' })
    expect(bs).toEqual({ ok: true, value: { a: [1, 3, 5, 7, 9], target: 7 } })
    const run = (key: string, patch: Record<string, string>) => {
      const r = parse(key, patch)
      if (!r.ok) throw new Error(r.error)
      const w = resolveWalk(key, r.value, g())
      if (!w.ok) throw new Error(w.error)
      return w.json.steps.length
    }
    expect(run('binarySearch', { values: '1,3,5,7,9', target: '7' })).toBe(13)
    expect(run('bfsGrid', { grid: 'S..\n##.\nE..' })).toBe(33)
    expect(run('coinChange', { coins: '1,2,5', amount: '11' })).toBe(68)
    expect(run('dijkstra', { edges: 'A-B:1, A-C:4, B-C:2, C-D:1', start: 'A' })).toBe(31)
    expect(run('bellmanFord', { edges: 'A-B:1, A-C:4, B-C:2, C-D:1', start: 'A' })).toBe(31)
    expect(parse('bubbleSort', { values: '3,1,2' })).toEqual({ ok: true, value: [3, 1, 2] })
    expect(parse('bfs', { edges: 'A-B, A-C, B-D', start: 'A' })).toMatchObject({ ok: true, value: { graph: { edges: [['A', 'B'], ['A', 'C'], ['B', 'D']] }, start: 'A' } })
  })

  it('names the first failing rule with its exact message (S32)', () => {
    expect(err('binarySearch', { values: '1,3,x' })).toBe('values: Only whole numbers from -999 to 999, separated by commas.')
    expect(err('binarySearch', { values: '9,7,5' })).toBe('values: Needs a sorted array (ascending).')
    expect(err('binarySearch', { values: '1,2,3,4,5,6,7,8,9,10,11,12,13' })).toBe('values: Too many items: the limit is 12.')
    expect(err('binarySearch', { values: '1,2,3', target: '' })).toBe('target: Target must be a whole number.')
    expect(err('bfsGrid', { grid: 'S...\n##.\nE..' })).toBe('grid: Every grid row must be the same length.')
    expect(err('bfsGrid', { grid: 'S.X\n...\nE..' })).toBe('grid: Use only S, E, . and # in the grid.')
    expect(err('bfsGrid', { grid: '...\n...\nE..' })).toBe('grid: The grid needs exactly one S and one E.')
    expect(err('bfsGrid', { grid: 'S........\n........E' })).toBe('grid: Grid is at most 8 × 8.')
    expect(err('bfs', { edges: 'A-B, B-C, C-D, D-E, E-F, F-G, G-H, H-I' })).toBe('edges: Too many nodes: the limit is 8.')
    expect(err('bfs', { edges: 'A->B' })).toBe('edges: Edges look like A-B or A-B:4.')
    expect(err('bfs', { edges: 'A-B', start: 'Z' })).toBe("start: Start node must be one of the graph's nodes.")
    expect(err('dijkstra', { edges: 'A-B:-2' })).toBe('edges: Dijkstra needs non-negative weights.')
    expect(err('bellmanFord', { edges: 'A-B:-2', start: 'A' })).toBe('ok')
    expect(err('topoSort', { edges: 'A-B, B-C, C-A' })).toBe('edges: Topological sort needs a graph without cycles.')
    expect(err('coinChange', { amount: '12' })).toBe('amount: Amount must be 1 to 11.')
    expect(err('coinChange', { coins: '1, 0' })).toBe('coins: Coins are positive whole numbers.')
    expect(err('lcs', { first: 'ABCDEFGH' })).toBe('first: Each string is 1 to 7 characters.')
    expect(err('slidingWindow', { k: '9' })).toBe('k: k must be between 1 and the number of values.')
    expect(err('knapsack', { items: '1:1, 2:2, 3:3, 4:4, 5:5, 6:6, 7:7, 8:8' })).toBe('items: Up to 7 items, each weight:value.')
    expect(err('knapsack', { capacity: '8' })).toBe('capacity: Capacity must be 1 to 7.')
    expect(err('nQueens', { n: '9' })).toBe('n: n must be 4 to 8.')
    expect(err('mergeIntervals', { intervals: '6-2' })).toBe('intervals: Each interval is start-end with start ≤ end.')
    expect(err('bitCount', { number: '256' })).toBe('number: Number must be 0 to 255.')
    expect(err('validParens', { brackets: '(a)' })).toBe('brackets: Use only ( ) [ ] { }.')
    expect(err('hashInsert', { buckets: '9' })).toBe('buckets: Buckets must be 1 to 8.')
  })
})

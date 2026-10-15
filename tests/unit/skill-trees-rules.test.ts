import { describe, expect, it } from 'vitest'
import {
  aiAreasOf, aiNodesOf, areaColorIndex, areaSummaries, difficultyWord, isTreeArea, layoutAreas, nextItemOf, nextTicketOf, nodeStates, summaryLine,
  treeItemRoute, treeProgress,
} from '../../src/rules/skillView'
import { mkPlanV2, mkTicket, AREAS, NODES } from '../helpers/planV2'
import type { PlanArea, PlanNode } from '../../src/data/planV2'

const treeAreas: PlanArea[] = [
  { id: 'dsa', name: 'Data structures and algorithms', tag: 'DS', why: 'w', pre: [] },
  { id: 'design', name: 'System design', tag: 'SD', why: 'w', pre: [] },
]
const nd = (id: string, area: string, pre: string[]): PlanNode => ({ id, area, phase: 1, kind: 'topic', title: id, oneLiner: 'o', why: 'w', pre, explain: [], hours: 1 })
const treeNodes: PlanNode[] = [nd('DA01', 'dsa', []), nd('DA02', 'dsa', ['DA01']), nd('SD01', 'design', []), nd('SD02', 'design', ['SD01'])]
const plan = mkPlanV2({ areas: [...AREAS, ...treeAreas], nodes: [...NODES, ...treeNodes] })
const item = (id: string, node: string, area: string, order: number, status: string = 'todo', over = {}) =>
  mkTicket({ id, node, area, lane: area === 'dsa' ? 'dsa' : 'design', kind: area === 'dsa' ? 'problem' : 'design', order, status: status as never, difficulty: 'M', ...over })

describe('AI scoping (SKILLS-02, SKILLS-04, TREE-04)', () => {
  it('tells tree areas from AI areas', () => {
    expect(isTreeArea('dsa')).toBe(true)
    expect(isTreeArea('design')).toBe(true)
    expect(isTreeArea('llm')).toBe(false)
    expect(aiAreasOf(plan).map(a => a.id)).toEqual(AREAS.map(a => a.id))
    expect(aiNodesOf(plan).map(n => n.id)).toEqual(NODES.map(n => n.id))
  })
  it('the area map has one tile per AI area and keeps the mockup grid (no layered fallback)', () => {
    const m = layoutAreas(aiAreasOf(plan))
    expect(m.tiles).toHaveLength(10)
    expect(m.tiles.find(t => t.area.id === 'llm')).toMatchObject({ c: 1, r: 1 })
  })
  it('summaryLine and area summaries count nodes and areas of AI areas only', () => {
    const states = nodeStates(plan, [], null)
    expect(summaryLine(plan, states)).toBe('0 of 8 topics done · pick an area to open it')
    expect(areaSummaries(plan, [], states).map(s => s.area.id)).toEqual(AREAS.map(a => a.id))
  })
})

describe('next item of a node (SKILLS-17, TREE Definitions)', () => {
  const ts = [item('a', 'DA01', 'dsa', 1, 'todo'), item('b', 'DA01', 'dsa', 2, 'doing'), item('c', 'DA01', 'dsa', 3, 'todo')]
  it('a tree node takes its first doing item, else its first todo item', () => {
    expect(nextItemOf('DA01', ts)?.id).toBe('b')
    expect(nextItemOf('DA01', ts.map(t => (t.id === 'b' ? { ...t, status: 'done' as const } : t)))?.id).toBe('a')
  })
  it('blocked and help items are skipped; a node with only done, blocked or help items has no next item', () => {
    const only = [item('a', 'DA01', 'dsa', 1, 'blocked'), item('b', 'DA01', 'dsa', 2, 'help'), item('c', 'DA01', 'dsa', 3, 'done')]
    expect(nextItemOf('DA01', only)).toBeNull()
    expect(nextTicketOf('DA01', only)).toBeNull()
    expect(nextTicketOf('DA01', [item('x', 'DA01', 'dsa', 1, 'blocked'), item('y', 'DA01', 'dsa', 2, 'todo')])?.id).toBe('y')
  })
  it('AI nodes keep the first todo or doing ticket by effective order', () => {
    const ai = [mkTicket({ id: 'q1', node: 'L3', order: 5, status: 'todo' }), mkTicket({ id: 'q2', node: 'L3', order: 6, status: 'doing' })]
    expect(nextTicketOf('L3', ai)?.id).toBe('q1')
  })
})

describe('tree progress and item display (TREE-05, TREE-09, TREE-10)', () => {
  const ts = [
    item('a', 'DA01', 'dsa', 1, 'done'), item('b', 'DA01', 'dsa', 2, 'todo'), item('c', 'DA02', 'dsa', 3, 'done', { archived: true }),
    item('d', 'SD01', 'design', 4, 'done'),
    mkTicket({ id: 'bank1', lane: 'bank', order: 9, status: 'done' }),
  ]
  it('counts done and all non-archived items whose node is a node of the tree', () => {
    expect(treeProgress(plan, 'dsa', ts)).toEqual({ done: 1, total: 2 })
    expect(treeProgress(plan, 'design', ts)).toEqual({ done: 1, total: 1 })
  })
  it('difficulty text, route and colour index', () => {
    expect(difficultyWord('E')).toBe('Easy')
    expect(difficultyWord('M')).toBe('Medium')
    expect(difficultyWord('H')).toBe('Hard')
    expect(treeItemRoute({ id: 'p200', kind: 'problem' })).toBe('/do/p200')
    expect(treeItemRoute({ id: 'd-method', kind: 'design' })).toBe('/designs/session/d-method')
    expect(areaColorIndex(plan, 'llm')).toBe(1)
    expect(areaColorIndex(plan, 'ai')).toBe(10)
    expect(areaColorIndex(plan, 'dsa')).toBeGreaterThanOrEqual(1)
    expect(areaColorIndex(plan, 'dsa')).toBeLessThanOrEqual(10)
    expect(areaColorIndex(plan, 'design')).not.toBe(areaColorIndex(plan, 'dsa'))
  })
  it('a quest on a DSA problem makes its tree node next (SKILLS-11, TREE-18)', () => {
    const states = nodeStates(plan, ts, 'b')
    expect(states.get('DA01')).toBe('next')
    expect([...states.values()].filter(s => s === 'next')).toHaveLength(1)
  })
})

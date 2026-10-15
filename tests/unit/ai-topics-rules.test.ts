import { describe, expect, it } from 'vitest'
import { aiTopics, hoursLabel, kindChipLabel, parseTopicFilter, TOPIC_KINDS } from '../../src/rules/aiTopics'
import { AREAS, mkPlanV2, mkTicket, NODES } from '../helpers/planV2'
import type { PlanArea, PlanNode } from '../../src/data/planV2'

const treeArea: PlanArea = { id: 'dsa', name: 'DSA', tag: 'DS', why: 'w', pre: [] }
const treeNode: PlanNode = { id: 'DA01', area: 'dsa', phase: 1, kind: 'topic', title: 'T', oneLiner: 'o', why: 'w', pre: [], explain: [], hours: 1 }
const plan = mkPlanV2({ areas: [...AREAS, treeArea], nodes: [...NODES, treeNode] })
const t = (id: string, node: string, kind: string, status: string, estMin: number, over = {}) =>
  mkTicket({ id, node, kind: kind as never, status: status as never, estMin, ...over })
const tickets = [
  t('a', 'L1', 'watch', 'done', 45), t('b', 'L1', 'build', 'todo', 75), t('c', 'L1', 'build', 'done', 30),
  t('d', 'L2', 'read', 'doing', 40),
  t('e', 'M1', 'watch', 'todo', 45),
  t('x', 'L1', 'read', 'done', 99, { archived: true }),
  t('p1', 'DA01', 'problem', 'done', 30, { area: 'dsa' }),
  t('nonode', '', 'watch', 'done', 10),
]

describe('AI topics figures (NAV-16 to NAV-18)', () => {
  const v = aiTopics(plan, tickets, { phase: null, kind: null })
  it('one block per AI area in plan order, none for the trees, and a row for every node of the area in plan order', () => {
    expect(v.areas.map(a => a.area.id)).toEqual(['llm', 'measure', 'sched', 'ai'])
    expect(v.areas[0].nodes.map(n => n.node.id)).toEqual(['L1', 'L2', 'L3', 'L4', 'R1'])
  })
  it('counts the live tickets of a node, the done ones, minutes and kind chips in the fixed kind order', () => {
    const l1 = v.areas[0].nodes[0]
    expect(l1).toMatchObject({ count: 3, done: 2, minutes: 150 })
    expect(l1.kinds).toEqual([{ kind: 'watch', count: 1 }, { kind: 'build', count: 2 }])
    expect(v.areas[0].nodes[1]).toMatchObject({ count: 1, done: 0, minutes: 40, kinds: [{ kind: 'read', count: 1 }] })
  })
  it('a node without tickets is still listed with zeros and no chips', () => {
    const s1 = v.areas[2].nodes[0]
    expect(s1.node.id).toBe('S1')
    expect(s1).toMatchObject({ count: 0, done: 0, minutes: 0, kinds: [] })
  })
  it('area and summary totals; hours are minutes / 60 rounded once', () => {
    expect(v.areas[0]).toMatchObject({ done: 2, total: 4, minutes: 190 })
    expect(v).toMatchObject({ done: 2, total: 5, minutes: 235 })
    expect(hoursLabel(235)).toBe('3.9 h')
    expect(hoursLabel(0)).toBe('0 h')
    expect(hoursLabel(120)).toBe('2 h')
    expect(hoursLabel(90)).toBe('1.5 h')
  })
  it('kind labels and the chip order', () => {
    expect(TOPIC_KINDS).toEqual(['watch', 'read', 'build', 'writeup', 'problem', 'design', 'task', 'ritual'])
    expect(kindChipLabel('writeup')).toBe('Write-up')
    expect(v.kinds).toEqual(['watch', 'read', 'build'])
    expect(v.phases).toEqual([1, 2])
  })
})

describe('filters (NAV-19 to NAV-22)', () => {
  it('a phase filter keeps nodes of that phase, drops empty areas, and recomputes totals over what is left', () => {
    const v = aiTopics(plan, tickets, { phase: 2, kind: null })
    expect(v.areas.map(a => a.area.id)).toEqual(['sched'])
    expect(v.areas[0].nodes.map(n => n.node.id)).toEqual(['S1'])
    expect(v.total).toBe(0)
  })
  it('a kind filter keeps nodes with a ticket of that kind and counts only those tickets', () => {
    const v = aiTopics(plan, tickets, { phase: null, kind: 'build' })
    expect(v.areas.map(a => a.area.id)).toEqual(['llm'])
    expect(v.areas[0].nodes).toHaveLength(1)
    expect(v.areas[0].nodes[0]).toMatchObject({ count: 2, done: 1, minutes: 105, kinds: [{ kind: 'build', count: 2 }] })
    expect(v).toMatchObject({ done: 1, total: 2, minutes: 105 })
  })
  it('both filters must hold; no match leaves no area', () => {
    expect(aiTopics(plan, tickets, { phase: 1, kind: 'build' }).areas).toHaveLength(1)
    expect(aiTopics(plan, tickets, { phase: 2, kind: 'build' }).areas).toEqual([])
  })
  it('the chips do not change with the filter', () => {
    const v = aiTopics(plan, tickets, { phase: 2, kind: 'build' })
    expect(v.phases).toEqual([1, 2])
    expect(v.kinds).toEqual(['watch', 'read', 'build'])
  })
  it('parses ?phase and ?kind; a value with no chip is treated as all', () => {
    const f = (q: string) => parseTopicFilter(new URLSearchParams(q), [1, 2], ['watch', 'build'])
    expect(f('phase=2&kind=build')).toEqual({ phase: 2, kind: 'build' })
    expect(f('')).toEqual({ phase: null, kind: null })
    expect(f('phase=9&kind=ritual')).toEqual({ phase: null, kind: null })
    expect(f('phase=abc&kind=')).toEqual({ phase: null, kind: null })
  })
})

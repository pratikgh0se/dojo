// R1 W6: the pure rules behind /banks Design and AI (BANK-04 to BANK-06, BANK-11 to BANK-14, BANK-17, BANK-19).
import { describe, expect, it } from 'vitest'
import type { BankExtraRow, BankGradeRow, PlanQuestion, Redo } from '../../src/data/types'
import {
  applyFilters, bankRedoFor, extraRowsFrom, filtersFromParams, gradeRow, nodeProgress, nodesWithQuestions, openBankRedo, paramsWithFilters,
  progressOf, questionsOf, statusText, TYPE_LABEL,
} from '../../src/rules/bankQuestions'

const nodes = [
  { id: 'SD02', area: 'design', title: 'Caching' },
  { id: 'SD01', area: 'design', title: 'Estimation' },
  { id: 'L1', area: 'llm', title: 'Tokens' },
  { id: 'L2', area: 'llm', title: 'Attention' },
]
const mk = (id: string, node: string, difficulty: number, area: 'design' | 'ai' = 'design', type: PlanQuestion['type'] = 'concept'): PlanQuestion => ({
  id, area, node, type, difficulty, question: `Q ${id}`, answer: `A ${id}`, checklist: ['one'],
})
const qbank: PlanQuestion[] = [mk('b', 'SD01', 2), mk('a', 'SD01', 2), mk('c', 'SD01', 1, 'design', 'estimate'), mk('d', 'SD02', 3, 'design', 'tradeoff'), mk('e', 'L1', 1, 'ai'), mk('f', 'L2', 4, 'ai', 'design')]
const extra: BankExtraRow[] = [{ ...mk('x-SD02-1', 'SD02', 2), aiMade: true, at: 5 }]

describe('questionsOf (BANK-04 order)', () => {
  it('lists one area, shipped plus AI-made, by the node plan order then difficulty then id', () => {
    const qs = questionsOf('design', qbank, extra, nodes)
    expect(qs.map(q => q.id)).toEqual(['x-SD02-1', 'd', 'c', 'a', 'b'])
  })
  it('marks AI-made rows and never shipped ones', () => {
    const qs = questionsOf('design', qbank, extra, nodes)
    expect(qs.filter(q => q.aiMade).map(q => q.id)).toEqual(['x-SD02-1'])
  })
  it('handles a plan with no qbank and no extra rows', () => {
    expect(questionsOf('ai', undefined, undefined, nodes)).toEqual([])
  })
  it('ignores a question whose node is not in the plan', () => {
    expect(questionsOf('ai', [mk('z', 'NOPE', 1, 'ai')], [], nodes)).toEqual([])
  })
})

describe('filters (BANK-05, BANK-06)', () => {
  const qs = questionsOf('design', qbank, extra, nodes)
  it('reads node, type and level from the address and drops values the area does not offer', () => {
    expect(filtersFromParams(new URLSearchParams('area=design&node=SD01&type=estimate&diff=1'), qs)).toEqual({ node: 'SD01', type: 'estimate', level: '1' })
    expect(filtersFromParams(new URLSearchParams('node=ZZ&type=quiz&diff=9'), qs)).toEqual({ node: '', type: '', level: '' })
    expect(filtersFromParams(new URLSearchParams(''), qs)).toEqual({ node: '', type: '', level: '' })
  })
  it('writes only the filters that are set and keeps other parameters', () => {
    const p = paramsWithFilters(new URLSearchParams('area=ai&node=OLD'), { node: '', type: 'concept', level: '3' })
    expect(p.get('area')).toBe('ai')
    expect(p.get('node')).toBeNull()
    expect(p.get('type')).toBe('concept')
    expect(p.get('diff')).toBe('3')
  })
  it('ANDs the filters', () => {
    expect(applyFilters(qs, { node: 'SD01', type: '', level: '' }).map(q => q.id)).toEqual(['c', 'a', 'b'])
    expect(applyFilters(qs, { node: 'SD01', type: 'concept', level: '2' }).map(q => q.id)).toEqual(['a', 'b'])
    expect(applyFilters(qs, { node: 'SD01', type: 'tradeoff', level: '' })).toEqual([])
    expect(applyFilters(qs, { node: '', type: '', level: '' })).toHaveLength(5)
  })
  it('offers the nodes of the area that have at least one question, in plan order', () => {
    expect(nodesWithQuestions(qs, nodes).map(n => n.id)).toEqual(['SD02', 'SD01'])
    expect(nodesWithQuestions(questionsOf('ai', qbank, [], nodes), nodes).map(n => n.title)).toEqual(['Tokens', 'Attention'])
  })
})

describe('progress (BANK-17)', () => {
  const grades: BankGradeRow[] = [
    { id: 'a', area: 'design', node: 'SD01', grade: 'hard', at: 1, tries: 1 },
    { id: 'd', area: 'design', node: 'SD02', grade: 'good', at: 1, tries: 2 },
    { id: 'gone', area: 'design', node: 'SD02', grade: 'easy', at: 1, tries: 1 },
  ]
  const qs = questionsOf('design', qbank, extra, nodes)
  it('counts the area questions that have a grade row; a grade on a question that no longer exists does not count', () => {
    expect(progressOf(qs, grades)).toEqual({ seen: 2, total: 5 })
    expect(nodeProgress(qs, grades, 'SD02')).toEqual({ seen: 1, total: 2 })
  })
  it('words the status', () => {
    expect(statusText(undefined)).toBe('Not seen')
    expect(statusText(grades[0])).toBe('Last: Hard')
  })
  it('names the four types in words', () => {
    expect(TYPE_LABEL).toEqual({ concept: 'Concept', estimate: 'Estimate', tradeoff: 'Trade-off', design: 'Design' })
  })
})

describe('gradeRow (BANK-11, BANK-12)', () => {
  const q = questionsOf('design', qbank, [], nodes)[0]
  it('writes a first row with tries 1', () => {
    expect(gradeRow(undefined, q, 'hard', 100)).toEqual({ id: q.id, area: 'design', node: q.node, grade: 'hard', at: 100, tries: 1 })
  })
  it('keeps the id, takes the new grade and time and adds one try', () => {
    const prev: BankGradeRow = { id: q.id, area: 'design', node: q.node, grade: 'again', at: 50, tries: 2 }
    expect(gradeRow(prev, q, 'easy', 100)).toEqual({ id: q.id, area: 'design', node: q.node, grade: 'easy', at: 100, tries: 3 })
  })
})

describe('Add to Review (BANK-14)', () => {
  const NOW = new Date(2026, 10, 4, 10, 0, 0).getTime() // Wed 2026-11-04 10:00 local
  const q = questionsOf('design', qbank, [], nodes).find(x => x.id === 'c')!
  it('builds a bank_q check redo due three local days later', () => {
    const r = bankRedoFor(q, 'Estimation', NOW)
    expect(r).toMatchObject({ ticketId: 'c', source: 'bank_q', stage: 0, createdAt: NOW, due: '2026-11-07', passed: [], helpCost: 0, refunded: 0 })
    expect(r.piece).toEqual({ topic: 'Estimation', question: 'Q c', answer: 'A c', qid: 'c' })
    expect(r.closedAt).toBeUndefined()
    expect(r.id).toMatch(/^r-bankq-c-/)
  })
  it('finds the open bank_q redo of a question, and ignores a closed one or another source', () => {
    const open = bankRedoFor(q, 'Estimation', NOW)
    const closed: Redo = { ...bankRedoFor(q, 'Estimation', NOW - 1), id: 'r2', closedAt: NOW }
    const other: Redo = { ...open, id: 'r3', source: 'check_failed' }
    expect(openBankRedo([closed, other], 'c')).toBeUndefined()
    expect(openBankRedo([closed, other, open], 'c')?.id).toBe(open.id)
    expect(openBankRedo([open], 'other-id')).toBeUndefined()
  })
})

describe('extraRowsFrom (BANK-19)', () => {
  const out = Array.from({ length: 5 }, (_, i) => ({ type: 'concept' as const, difficulty: 1 + (i % 3), question: `Q${i}`, answer: 'A', checklist: ['c'] }))
  it('makes five rows of the area and node with aiMade true, unique ids and no source', () => {
    const rows = extraRowsFrom(out, { area: 'design', node: 'SD01' }, 1234, new Set(['x-SD01-ya-1']))
    expect(rows).toHaveLength(5)
    expect(new Set(rows.map(r => r.id)).size).toBe(5)
    for (const r of rows) {
      expect(r).toMatchObject({ area: 'design', node: 'SD01', aiMade: true, at: 1234 })
      expect('source' in r).toBe(false)
    }
  })
  it('never reuses an existing id', () => {
    const first = extraRowsFrom(out, { area: 'ai', node: 'L1' }, 7, new Set())
    const again = extraRowsFrom(out, { area: 'ai', node: 'L1' }, 7, new Set(first.map(r => r.id)))
    expect(again.some(r => first.some(f => f.id === r.id))).toBe(false)
  })
})

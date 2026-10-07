import { describe, expect, it } from 'vitest'
import type { ItemView } from '../../src/rules/banks'
import {
  applyFilters, cellLabel, cellTone, difficultyChip, difficultyOptions, hasFilters, matchesQuery, patternOptions,
  readBankId, readFilters, sanitizeFilters,
} from '../../src/rules/bankFilters'

const v = (p: Partial<ItemView> & { id: string; name: string }): ItemView => ({
  url: null, difficulty: 'M', pattern: null, group: 'g', kind: 'problem', plan: null, ticketId: p.id, ticket: null,
  done: false, readOnly: false, ...p,
})

const items = [
  v({ id: 'p1', name: 'Two Sum', num: 1, difficulty: 'E' }),
  v({ id: 'p167', name: 'Two Sum II - Input Array Is Sorted', num: 167, pattern: 'TWO POINTERS' }),
  v({ id: 'p200', name: 'Number of Islands', num: 200, pattern: 'BFS / DFS', done: true }),
  v({ id: 'p76', name: 'Minimum Window Substring', num: 76, difficulty: 'H', pattern: 'SLIDING WINDOW' }),
]
const q = (s: string) => new URLSearchParams(s)

describe('query string', () => {
  it('reads the bank, defaulting to plan for missing or unknown values', () => {
    expect(readBankId(q(''))).toBe('plan')
    expect(readBankId(q('bank=blind75'))).toBe('blind75')
    expect(readBankId(q('bank=zzz'))).toBe('plan')
  })
  it('reads filters and ignores unknown status values', () => {
    expect(readFilters(q('diff=H&pattern=BFS+%2F+DFS&status=done&q=two+sum'))).toEqual({ diff: 'H', pattern: 'BFS / DFS', status: 'done', q: 'two sum' })
    expect(readFilters(q('status=maybe'))).toEqual({ diff: null, pattern: null, status: null, q: '' })
    expect(hasFilters(readFilters(q('bank=blind75')))).toBe(false)
    expect(hasFilters(readFilters(q('q=x')))).toBe(true)
  })
  it('sanitizes values that are not offered for this bank', () => {
    const f = sanitizeFilters({ diff: 'Z', pattern: 'NOPE', status: null, q: '' }, difficultyOptions('blind75', items), patternOptions('blind75', items))
    expect(f).toEqual({ diff: null, pattern: null, status: null, q: '' })
    expect(sanitizeFilters({ diff: 'H', pattern: 'BFS / DFS', status: 'todo', q: '' }, null, null)).toEqual({ diff: null, pattern: null, status: 'todo', q: '' })
  })
})

describe('search', () => {
  it('is case-insensitive on the name and matches a number exactly or inside a name', () => {
    expect(items.filter(i => matchesQuery(i, 'two sum')).map(i => i.id)).toEqual(['p1', 'p167'])
    expect(items.filter(i => matchesQuery(i, 'ISLANDS')).map(i => i.id)).toEqual(['p200'])
    expect(items.filter(i => matchesQuery(i, '200')).map(i => i.id)).toEqual(['p200'])
    expect(items.filter(i => matchesQuery(i, '   ')).length).toBe(4)
  })
})

describe('applyFilters', () => {
  it('combines with AND', () => {
    expect(applyFilters(items, { diff: 'H', pattern: null, status: null, q: '' }).map(i => i.id)).toEqual(['p76'])
    expect(applyFilters(items, { diff: null, pattern: 'untagged', status: null, q: '' }).map(i => i.id)).toEqual(['p1'])
    expect(applyFilters(items, { diff: null, pattern: null, status: 'done', q: '' }).map(i => i.id)).toEqual(['p200'])
    expect(applyFilters(items, { diff: null, pattern: null, status: 'todo', q: '' }).map(i => i.id)).toEqual(['p1', 'p167', 'p76'])
    expect(applyFilters(items, { diff: 'E', pattern: null, status: null, q: 'islands' })).toEqual([])
  })
  it('matches Codeforces ratings as difficulty', () => {
    const cf = [v({ id: 'cf-1A', name: 'A', difficulty: 1200 }), v({ id: 'cf-2B', name: 'B', difficulty: 1600 })]
    expect(applyFilters(cf, { diff: '1600', pattern: null, status: null, q: '' }).map(i => i.id)).toEqual(['cf-2B'])
  })
})

describe('options', () => {
  it('Difficulty: E/M/H, ratings on Codeforces, hidden on Hello Interview', () => {
    expect(difficultyOptions('blind75', items)).toEqual([
      { value: '', label: 'All' }, { value: 'E', label: 'Easy' }, { value: 'M', label: 'Medium' }, { value: 'H', label: 'Hard' },
    ])
    const cf = [v({ id: 'a', name: 'a', difficulty: 1700 }), v({ id: 'b', name: 'b', difficulty: 1200 }), v({ id: 'c', name: 'c', difficulty: 1200 })]
    expect(difficultyOptions('codeforces', cf)).toEqual([{ value: '', label: 'All' }, { value: '1200', label: '1200' }, { value: '1700', label: '1700' }])
    expect(difficultyOptions('hellointerview', items)).toBeNull()
  })
  it('Pattern: only labels present, Atlas order, Untagged last; hidden on Hello Interview', () => {
    expect(patternOptions('blind75', items)).toEqual([
      { value: '', label: 'All patterns' }, { value: 'TWO POINTERS', label: 'TWO POINTERS' }, { value: 'SLIDING WINDOW', label: 'SLIDING WINDOW' },
      { value: 'BFS / DFS', label: 'BFS / DFS' }, { value: 'untagged', label: 'Untagged' },
    ])
    expect(patternOptions('hellointerview', items)).toBeNull()
  })
})

describe('chips and labels', () => {
  it('formats difficulty chips and cell tones', () => {
    expect(difficultyChip('E')).toBe('E')
    expect(difficultyChip(1400)).toBe('1400')
    expect(difficultyChip(null)).toBe('—')
    expect(cellTone('H')).toBe('diff-H')
    expect(cellTone(1300)).toBe('band-1300')
    expect(cellTone(1700)).toBe('band-other')
    expect(cellTone(null)).toBe('diff-none')
  })
  it('names cells `<name> · <difficulty> · todo|done` or `<name> · in plan S<n>`', () => {
    expect(cellLabel(items[0])).toBe('Two Sum · E · todo')
    expect(cellLabel(v({ id: 'p200', name: 'Number of Islands', plan: { ticketId: 'p200', marker: 'Plan · S1', href: '/dsa?topic=1', cubeLabel: 'in plan S1' } }))).toBe('Number of Islands · in plan S1')
  })
})

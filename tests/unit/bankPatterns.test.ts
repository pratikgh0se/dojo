import { describe, expect, it } from 'vitest'
import cfTags from '../../src/content/banks/cf-tags.json'
import groupPatterns from '../../src/content/banks/group-patterns.json'
import lcPatterns from '../../src/content/banks/lc-patterns.json'
import { BANK_TABS, DESIGN_OVERLAP, KNOWN_ITEM_ORDER } from '../../src/content/banks/meta'
import { cfTagPattern, isAtlasPattern, planSprintByNum, resolveLcPattern } from '../../src/rules/bankPatterns'

describe('bank metadata', () => {
  it('lists the Plan bank, the fixture packs and Mine, with the packs\' own source links', () => {
    expect(BANK_TABS.map(t => t.label)).toEqual(['Plan bank', 'Fixture Set A', 'Fixture Set B', 'Fixture Set C', 'Fixture Ladder', 'Fixture Designs', 'Mine'])
    expect(BANK_TABS.map(t => t.id)).toEqual(['plan', 'neetcode150', 'blind75', 'striver', 'codeforces', 'hellointerview', 'mine'])
    const src = Object.fromEntries(BANK_TABS.map(t => [t.id, t.source]))
    expect(src).toEqual({
      plan: null,
      neetcode150: 'https://example.com/fixture-sets/a',
      blind75: 'https://example.com/fixture-sets/b',
      striver: 'https://example.com/fixture-sets/c',
      codeforces: 'https://example.com/fixture-sets/ladder',
      hellointerview: 'https://example.com/fixture-sets/designs',
      mine: null,
    })
    expect(BANK_TABS.filter(t => t.snapshot === '2026-01-01').map(t => t.id)).toEqual(['neetcode150', 'blind75', 'striver', 'codeforces', 'hellointerview'])
  })

  it('pins the fixture design overlaps and the known-item order (Plan first)', () => {
    expect(DESIGN_OVERLAP).toEqual({ 'hi-fx-chat': 'd-chat', 'hi-fx-cache': 'd-cache' })
    expect(KNOWN_ITEM_ORDER).toEqual(['plan', 'blind75', 'neetcode150', 'striver', 'codeforces', 'hellointerview'])
  })

  it('the public build (no packs) has only the Plan bank and Mine', async () => {
    const empty = await import('../../src/content/banks/packs')
    expect(empty.PACK_META).toEqual([])
    expect(empty.PACK_DESIGN_OVERLAP).toEqual({})
    expect(await empty.loadPacks()).toEqual({})
  })
})

describe('pattern tables', () => {
  it('only use the 36 Atlas labels or null', () => {
    const values = [
      ...Object.values(lcPatterns as Record<string, string | null>),
      ...Object.values(groupPatterns as Record<string, Record<string, string | null>>).flatMap(g => Object.values(g)),
      ...Object.values(cfTags as Record<string, string>),
    ]
    for (const v of values) expect(v === null || isAtlasPattern(v), String(v)).toBe(true)
  })

  it('maps every Codeforces tag from the contract table', () => {
    expect(cfTags).toEqual({
      'two pointers': 'TWO POINTERS', 'binary search': 'BINARY SEARCH', sortings: 'SORTING', greedy: 'GREEDY',
      dp: 'DP · TABULATION', graphs: 'BFS / DFS', 'dfs and similar': 'BFS / DFS', 'shortest paths': 'SHORTEST PATH',
      dsu: 'UNION-FIND', trees: 'BFS / DFS', bitmasks: 'BIT TRICKS', 'number theory': 'NUMBER THEORY',
      combinatorics: 'COMBINATORICS', probabilities: 'PROBABILITY', geometry: 'GEOMETRY', games: 'GAME THEORY',
      strings: 'STRING MATCH', 'string suffix structures': 'STRING MATCH', hashing: 'STRING MATCH',
      'divide and conquer': 'DIVIDE & CONQUER', 'data structures': 'SEGMENT / FENWICK', implementation: 'SIMULATION',
      'brute force': 'BACKTRACKING',
    })
  })
})

describe('resolveLcPattern', () => {
  it('uses the per-number table first', () => {
    expect(resolveLcPattern(76, 15, 'plan', '')).toBe('SLIDING WINDOW')
    expect(resolveLcPattern(141, 18, 'plan', '')).toBe('CYCLE · FAST/SLOW')
    expect(resolveLcPattern(208, 6, 'plan', '')).toBe('TRIE')
    expect(resolveLcPattern(206, 18, 'plan', '')).toBeNull()
  })
  it('then the plan sprint default for in-plan problems', () => {
    expect(resolveLcPattern(200, 1, 'plan', '')).toBe('BFS / DFS')
    expect(resolveLcPattern(207, 2, 'plan', '')).toBe('TOPO SORT')
    expect(resolveLcPattern(215, 11, 'plan', '')).toBe('HEAP / PQ')
  })
  it('else null', () => {
    expect(resolveLcPattern(9999, undefined, 'plan', 'No such group')).toBeNull()
  })
})

describe('helpers', () => {
  it('cfTagPattern takes the first mapped tag', () => {
    expect(cfTagPattern(['math', 'greedy', 'dp'])).toBe('GREEDY')
    expect(cfTagPattern(['math', '*special'])).toBeNull()
    expect(cfTagPattern([])).toBeNull()
  })
  it('planSprintByNum keeps the first sprint a problem appears in', () => {
    const m = planSprintByNum([{ sprint: 3, problems: [{ num: 1 }] }, { sprint: 1, problems: [{ num: 1 }, { num: 2 }] }])
    expect(m.get(1)).toBe(3)
    expect(m.get(2)).toBe(1)
  })
})

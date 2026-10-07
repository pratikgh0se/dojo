import { describe, expect, it } from 'vitest'
import { loadPacks } from '@bank-packs'
import { buildBanks, type BankEntry } from '../../src/rules/banks'
import { ladderResultText, ladderRow, parseLadderJson, splitLadder } from '../../src/rules/cfLadder'
import { isDuplicateInMine, knownItem, mineDifficulty, parseMineInput, sourceOfUrl } from '../../src/rules/mine'
import { realPlan } from '../helpers/plan'

const banks = buildBanks(realPlan(), await loadPacks(), [])

describe('parseMineInput', () => {
  it('LeetCode URL → capitalized slug title, canonical URL, no id yet', () => {
    for (const url of [
      'https://leetcode.com/problems/maximum-number-of-robots-within-budget/',
      'https://leetcode.com/problems/maximum-number-of-robots-within-budget',
      '  https://www.leetcode.com/problems/Maximum-Number-Of-Robots-Within-Budget/?envType=daily  ',
    ]) {
      expect(parseMineInput(url)).toEqual({
        source: 'LeetCode', title: 'Maximum Number Of Robots Within Budget',
        url: 'https://leetcode.com/problems/maximum-number-of-robots-within-budget/',
        slug: 'maximum-number-of-robots-within-budget', contestId: null, index: null, id: null,
      })
    }
  })
  it('Codeforces problemset and contest URLs → the same id', () => {
    const want = { source: 'Codeforces', title: 'CF 9998A', url: 'https://codeforces.com/problemset/problem/9998/A', slug: null, contestId: 9998, index: 'A', id: 'cf-9998A' }
    expect(parseMineInput('https://codeforces.com/problemset/problem/9998/A')).toEqual(want)
    expect(parseMineInput('https://codeforces.com/contest/9998/problem/a')).toEqual(want)
  })
  it('anything else → first non-empty line, 80 characters, no link', () => {
    expect(parseMineInput('\n\n  Kadane on a circular array  \nmore text')).toMatchObject({ source: 'Text', title: 'Kadane on a circular array', url: null, id: null })
    expect(parseMineInput('x'.repeat(100)).title).toHaveLength(80)
  })
})

describe('knownItem and duplicates', () => {
  it('finds a problem listed in two packs in the first pack of the known-item order and reuses its id', () => {
    const k = knownItem(parseMineInput('https://leetcode.com/problems/fixture-pair-finder/'), banks)
    expect(k?.label).toBe('Fixture Set B')
    expect(k?.entry).toMatchObject({ id: 'p9001', name: 'Pair Finder', difficulty: 'E' })
  })
  it('prefers the Plan bank for plan problems and finds shipped Codeforces items', () => {
    expect(knownItem(parseMineInput('https://leetcode.com/problems/number-of-islands'), banks)?.label).toBe('Plan bank')
    const cf = banks.codeforces.entries[0]
    expect(knownItem(parseMineInput(`https://codeforces.com/contest/${cf.contestId}/problem/${cf.index}`), banks)?.entry.id).toBe(cf.id)
    expect(knownItem(parseMineInput('https://codeforces.com/problemset/problem/9998/A'), banks)).toBeNull()
    expect(knownItem(parseMineInput('Two Sum'), banks)).toBeNull()
  })
  it('detects duplicates by id or canonical LeetCode URL', () => {
    const mine: BankEntry[] = [
      { id: 'mine-x1', name: 'Robots', url: 'https://leetcode.com/problems/maximum-number-of-robots-within-budget/', difficulty: 'M', pattern: null, group: 'Untagged', kind: 'problem' },
      { id: 'cf-9998A', name: 'CF 9998A', url: 'https://codeforces.com/problemset/problem/9998/A', difficulty: 'M', pattern: null, group: 'Untagged', kind: 'problem' },
    ]
    const robots = parseMineInput('https://leetcode.com/problems/maximum-number-of-robots-within-budget')
    expect(isDuplicateInMine(robots, null, mine)).toBe(true)
    expect(isDuplicateInMine(parseMineInput('https://codeforces.com/contest/9998/problem/A'), null, mine)).toBe(true)
    const twoSum = parseMineInput('https://leetcode.com/problems/two-sum/')
    expect(isDuplicateInMine(twoSum, knownItem(twoSum, banks), mine)).toBe(false)
    expect(isDuplicateInMine(parseMineInput('Kadane'), null, mine)).toBe(false)
  })
  it('maps any difficulty to E/M/H and URLs to a source', () => {
    expect([mineDifficulty('H'), mineDifficulty(null), mineDifficulty(1300), mineDifficulty(1600), mineDifficulty(2000)]).toEqual(['H', 'M', 'E', 'M', 'H'])
    expect([sourceOfUrl('https://leetcode.com/problems/a/'), sourceOfUrl('https://codeforces.com/problemset/problem/1/A'), sourceOfUrl(null)]).toEqual(['LeetCode', 'Codeforces', 'Text'])
  })
})

describe('ladder JSON', () => {
  const probe = '[{"contestId":9999,"index":"Z","name":"Contract Import Probe","rating":1700,"tags":["greedy"]}]'
  it('parses the contract probe and the API wrapper', () => {
    expect(parseLadderJson(probe)).toEqual({ ok: true, items: [{ contestId: 9999, index: 'Z', name: 'Contract Import Probe', rating: 1700, tags: ['greedy'] }] })
    const wrapped = JSON.stringify({ status: 'OK', result: { problems: [{ contestId: 1, index: 'a', name: 'A', rating: 800 }] } })
    expect(parseLadderJson(wrapped)).toEqual({ ok: true, items: [{ contestId: 1, index: 'A', name: 'A', rating: 800, tags: [] }] })
  })
  it('rejects bad input with an `Invalid ladder JSON` message', () => {
    for (const bad of ['not json', '[{"name":"x"}]', '[]', '{}', 'null', '[{"contestId":1,"index":"A","name":"","rating":1200}]']) {
      const r = parseLadderJson(bad)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error.startsWith('Invalid ladder JSON')).toBe(true)
    }
  })
  it('splits fresh from present, de-duplicating inside one paste', () => {
    const r = parseLadderJson('[{"contestId":1,"index":"A","name":"A","rating":1200},{"contestId":1,"index":"A","name":"A","rating":1200},{"contestId":2,"index":"B","name":"B","rating":1300}]')
    if (!r.ok) throw new Error(r.error)
    const s = splitLadder(r.items, new Set(['cf-2B']))
    expect(s.fresh.map(x => x.contestId)).toEqual([1])
    expect(s.present).toBe(1)
    expect(ladderResultText(1, 0)).toBe('1 new, 0 already present')
  })
  it('builds a bankItems row with the tag pattern', () => {
    expect(ladderRow({ contestId: 9999, index: 'Z', name: 'Probe', rating: 1700, tags: ['math', 'greedy'] }, 5)).toEqual({
      id: 'codeforces:cf-9999Z', bank: 'codeforces', key: 'cf-9999Z', name: 'Probe',
      url: 'https://codeforces.com/problemset/problem/9999/Z', pattern: 'GREEDY', rating: 1700, status: 'todo', addedAt: 5,
    })
  })
})

import { describe, expect, it } from 'vitest'
import type { BankItem, PlanJson, Ticket } from '../../src/data/types'
import type { ShippedBank, ShippedBankId } from '../../src/content/banks/types'
import { loadPacks } from '@bank-packs'
import { allViews, buildBanks, countDone, groupSlug, groupViews, planBank, planRefs, storedEntry } from '../../src/rules/banks'
import { liveTicketMap } from '../../src/rules/board'
import { realPlan, smallPlan } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'

const miniPlan: PlanJson = {
  ...smallPlan,
  dsa_bank: [
    { sprint: 2, topic: 'Topological sort', pattern: 'Topological Sort', note: '', problems: [{ num: 207, name: 'Course Schedule', url: 'https://leetcode.com/problems/course-schedule/', difficulty: 'M' }] },
    { sprint: 1, topic: 'Graphs: BFS and DFS', pattern: 'Graphs', note: '', problems: [{ num: 200, name: 'Number of Islands', url: 'https://leetcode.com/problems/number-of-islands/', difficulty: 'M' }] },
  ],
  design_bank: [
    { tier: 'Foundations (sprints 21 to 24)', skill: 'sd', items: [{ id: 'd-method', title: 'Method', difficulty: 'M', deep_dives: [], refs: [] }] },
    { tier: 'Hard classic designs (sprints 33 to 36)', skill: 'sd', items: [{ id: 'd-chat', title: 'Chat at WhatsApp scale', difficulty: 'H', deep_dives: [], refs: [] }] },
  ],
}

const shipped = (bank: ShippedBankId, items: ShippedBank['items'], groups: string[]): ShippedBank =>
  ({ bank, source: 's', snapshot: '2026-09-28', fetchedAt: 'x', via: 'v', groups, items })

const SHIPPED: Record<ShippedBankId, ShippedBank> = {
  neetcode150: shipped('neetcode150', [
    { id: 'p1', name: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', difficulty: 'E', pattern: null, group: 'Arrays & Hashing', num: 1 },
    { id: 'p207', name: 'Course Schedule', url: 'https://leetcode.com/problems/course-schedule/', difficulty: 'M', pattern: 'TOPO SORT', group: 'Graphs', num: 207 },
  ], ['Arrays & Hashing', 'Graphs']),
  blind75: shipped('blind75', [
    { id: 'p1', name: 'Two Sum', url: 'https://leetcode.com/problems/two-sum/', difficulty: 'E', pattern: null, group: 'Array', num: 1 },
    { id: 'p200', name: 'Number of Islands', url: 'https://leetcode.com/problems/number-of-islands/', difficulty: 'M', pattern: 'BFS / DFS', group: 'Graph', num: 200 },
  ], ['Array', 'Graph']),
  striver: shipped('striver', [], []),
  codeforces: shipped('codeforces', [
    { id: 'cf-4C', name: 'Registration System', url: 'https://codeforces.com/problemset/problem/4/C', difficulty: 1300, pattern: 'STRING MATCH', group: '1300', contestId: 4, index: 'C' },
  ], ['1300']),
  hellointerview: shipped('hellointerview', [
    { id: 'hi-fx-solo', name: 'Fixture Solo', url: 'https://example.com/fixture/solo', difficulty: null, pattern: null, group: 'Problem breakdowns' },
    { id: 'hi-fx-chat', name: 'Fixture Chat', url: 'https://example.com/fixture/chat', difficulty: null, pattern: null, group: 'Problem breakdowns' },
  ], ['Problem breakdowns']),
}

const mineRow = (key: string, pattern: BankItem['pattern'], addedAt: number, extra: Partial<BankItem> = {}): BankItem =>
  ({ id: `mine:${key}`, bank: 'mine', key, name: key, pattern, difficulty: 'M', status: 'todo', ticketId: key, addedAt, ...extra }) as BankItem

describe('groupSlug', () => {
  it('lowercases and collapses non-alphanumerics', () => {
    expect(groupSlug('Array')).toBe('array')
    expect(groupSlug('Arrays & Hashing')).toBe('arrays-hashing')
    expect(groupSlug('1200')).toBe('1200')
    expect(groupSlug('S1 · Graphs: BFS and DFS')).toBe('s1-graphs-bfs-and-dfs')
    expect(groupSlug('DP · TABULATION')).toBe('dp-tabulation')
  })
})

describe('planRefs and planBank', () => {
  it('maps plan problems to their topic and the 12 designs to their tier', () => {
    const refs = planRefs(miniPlan)
    expect(refs.get('p200')).toEqual({ ticketId: 'p200', marker: 'Plan · S1', href: '/dsa?topic=1', cubeLabel: 'in plan S1' })
    expect(refs.get('hi-fx-chat')).toEqual({ ticketId: 'd-chat', marker: 'Plan · d-chat', href: '/designs?tier=2', cubeLabel: 'in plan d-chat' })
    expect(refs.has('hi-fx-solo')).toBe(false)
    expect(refs.has('hi-fx-cache')).toBe(false) // d-cache is not in this plan
  })
  it('builds the Plan bank in dsa_bank file order with S<n> · <topic> groups', () => {
    const b = planBank(miniPlan)
    expect(b.groups).toEqual(['S2 · Topological sort', 'S1 · Graphs: BFS and DFS'])
    expect(b.entries.map(e => [e.id, e.pattern, e.group])).toEqual([
      ['p207', 'TOPO SORT', 'S2 · Topological sort'],
      ['p200', 'BFS / DFS', 'S1 · Graphs: BFS and DFS'],
    ])
  })
  it('has 169 items for the live plan', () => {
    expect(planBank(realPlan()).entries).toHaveLength(169)
  })
})

describe('buildBanks', () => {
  it('adds imported Codeforces rows as new rating groups, sorted numerically, without duplicating shipped ids', () => {
    const rows = [
      { id: 'codeforces:cf-9999Z', bank: 'codeforces', key: 'cf-9999Z', name: 'Probe', url: 'https://codeforces.com/problemset/problem/9999/Z', pattern: 'GREEDY', rating: 1700, status: 'todo', addedAt: 5 } as BankItem,
      { id: 'codeforces:cf-4C', bank: 'codeforces', key: 'cf-4C', name: 'Dup', url: 'https://codeforces.com/problemset/problem/4/C', pattern: null, rating: 1300, status: 'todo', addedAt: 6 } as BankItem,
    ]
    const cf = buildBanks(miniPlan, SHIPPED, rows).codeforces
    expect(cf.groups).toEqual(['1300', '1700'])
    expect(cf.entries.map(e => e.id)).toEqual(['cf-4C', 'cf-9999Z'])
    expect(cf.entries[1]).toMatchObject({ difficulty: 1700, pattern: 'GREEDY', group: '1700', contestId: 9999, index: 'Z', rowId: 'codeforces:cf-9999Z' })
  })
  it('groups Mine by pattern in Atlas order with Untagged last, oldest first', () => {
    const rows = [mineRow('mine-b', null, 3), mineRow('mine-c', 'GREEDY', 2), mineRow('mine-a', 'TWO POINTERS', 1)]
    const mine = buildBanks(miniPlan, SHIPPED, rows).mine
    expect(mine.groups).toEqual(['TWO POINTERS', 'GREEDY', 'Untagged'])
    expect(mine.entries.map(e => e.id)).toEqual(['mine-a', 'mine-c', 'mine-b'])
    expect(storedEntry(rows[0])).toMatchObject({ id: 'mine-b', group: 'Untagged', difficulty: 'M', url: null, rowId: 'mine:mine-b' })
  })
  it('marks Hello Interview entries as designs and everything else as problems', () => {
    const banks = buildBanks(miniPlan, SHIPPED, [])
    expect(banks.hellointerview.entries.every(e => e.kind === 'design')).toBe(true)
    expect(banks.blind75.entries.every(e => e.kind === 'problem')).toBe(true)
  })
})

describe('item views: one problem, one ticket', () => {
  const refs = planRefs(miniPlan)
  const bank = (tickets: Ticket[]) => allViews(buildBanks(miniPlan, SHIPPED, []), refs, liveTicketMap(tickets))

  it('an in-plan item points at the plan ticket; a missing plan ticket is read-only', () => {
    const v = bank([mkTicket({ id: 'p200', kind: 'problem', status: 'done' })])
    const p200 = v.blind75.find(i => i.id === 'p200')!
    expect(p200).toMatchObject({ ticketId: 'p200', done: true, readOnly: false })
    expect(p200.plan?.marker).toBe('Plan · S1')
    const p207 = v.neetcode150.find(i => i.id === 'p207')!
    expect(p207).toMatchObject({ ticketId: 'p207', done: false, readOnly: true })
    expect(v.hellointerview.find(i => i.id === 'hi-fx-chat')!.ticketId).toBe('d-chat')
  })
  it('the same bank-only id is done in every bank that lists it', () => {
    const v = bank([mkTicket({ id: 'p1', origin: 'bank:blind75', kind: 'problem', status: 'done' })])
    expect(v.blind75.find(i => i.id === 'p1')!.done).toBe(true)
    expect(v.neetcode150.find(i => i.id === 'p1')!.done).toBe(true)
    expect(countDone(v.neetcode150)).toEqual({ done: 1, total: 2 })
    expect(countDone(v.plan)).toEqual({ done: 0, total: 2 })
  })
  it('archived tickets do not count as done', () => {
    const v = bank([mkTicket({ id: 'p1', origin: 'bank:blind75', kind: 'problem', status: 'done', archived: true })])
    expect(v.blind75.find(i => i.id === 'p1')!.done).toBe(false)
  })
})

describe('groupViews', () => {
  it('counts over all items, shows only visible rows and hides empty groups', () => {
    const v = allViews(buildBanks(miniPlan, SHIPPED, []), planRefs(miniPlan), liveTicketMap([]))
    const all = v.blind75
    const g = groupViews(['Array', 'Graph'], all, all.filter(i => i.id === 'p200'))
    expect(g.map(x => [x.title, x.slug, x.items.map(i => i.id), x.done, x.total])).toEqual([['Graph', 'graph', ['p200'], 0, 1]])
  })
})

describe('shared ticket for same LeetCode number (contract DECISION 9)', () => {
  it('a variant row with the same num shares p<num> with the canonical row and the plan ticket', async () => {
    const packs = await loadPacks()
    const withVariant = {
      ...packs,
      striver: { ...packs.striver!, items: [...packs.striver!.items, { id: 'striver-variant-of-207', name: 'Variant', url: 'https://example.com/v', difficulty: 'M' as const, pattern: null, group: packs.striver!.groups[0], num: 207 }] },
    }
    const v = allViews(buildBanks(realPlan(), withVariant, []), planRefs(realPlan()), liveTicketMap([mkTicket({ id: 'p207', kind: 'problem', status: 'done' })]))
    const variant = v.striver.find(i => i.id === 'striver-variant-of-207')!
    expect(variant.ticketId).toBe('p207')
    expect(variant.done).toBe(true)
    expect(v.neetcode150.find(i => i.id === 'p207')!.done).toBe(true)
  })
})

describe('fixture packs with the live plan', () => {
  it('count the fixtures, and link in-plan items and the two overlapping designs', async () => {
    const v = allViews(buildBanks(realPlan(), await loadPacks(), []), planRefs(realPlan()), liveTicketMap([]))
    expect([v.plan.length, v.neetcode150.length, v.blind75.length, v.striver.length, v.codeforces.length, v.hellointerview.length, v.mine.length]).toEqual([169, 6, 6, 4, 5, 3, 0])
    expect(v.neetcode150.find(i => i.id === 'p207')!.plan?.marker).toBe('Plan · S2')
    expect(v.blind75.find(i => i.id === 'p200')!.plan?.marker).toBe('Plan · S1')
    expect(v.neetcode150.find(i => i.id === 'p9001')!.plan).toBeNull()
    expect(v.hellointerview.filter(i => i.plan).length).toBe(2)
  })
})

describe('no packs (the public build)', () => {
  it('builds empty pack banks and keeps imported ladder rows', () => {
    const rows = [{ id: 'codeforces:cf-9999Z', bank: 'codeforces', key: 'cf-9999Z', name: 'Probe', url: 'https://codeforces.com/problemset/problem/9999/Z', pattern: null, rating: 1700, status: 'todo', addedAt: 5 } as BankItem]
    const b = buildBanks(miniPlan, {}, rows)
    expect(b.blind75.entries).toEqual([])
    expect(b.codeforces.entries.map(e => e.id)).toEqual(['cf-9999Z'])
  })
})

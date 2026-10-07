import { describe, expect, it } from 'vitest'
import type { Ticket } from '../../src/data/types'
import { dsaTopics, dsaTotals, neetcodeUrl } from '../../src/rules/dsa'
import { newTicket, planToTickets } from '../../src/rules/planTickets'
import { realPlan, smallPlan } from '../helpers/plan'
import { smallTickets } from '../helpers/tickets'

const mark = (ts: Ticket[], ids: string[], patch: Partial<Ticket>) => ts.map(t => (ids.includes(t.id) ? { ...t, ...patch } : t))

describe('neetcodeUrl', () => {
  it('maps a LeetCode problem URL to the NeetCode solution page', () => {
    expect(neetcodeUrl('https://leetcode.com/problems/number-of-islands/')).toBe('https://neetcode.io/solutions/number-of-islands')
    expect(neetcodeUrl('https://leetcode.com/problems/two-sum')).toBe('https://neetcode.io/solutions/two-sum')
    expect(neetcodeUrl('https://www.leetcode.com/problems/two-sum/description/')).toBe('https://neetcode.io/solutions/two-sum')
  })
  it('returns null for anything else', () => {
    expect(neetcodeUrl('not a url')).toBeNull()
    expect(neetcodeUrl('https://leetcode.com/problemset/')).toBeNull()
    expect(neetcodeUrl('https://example.com/problems/two-sum/')).toBeNull()
  })
})

describe('dsaTopics', () => {
  it('joins problems to p<num> tickets in file order', () => {
    const [topic] = dsaTopics(smallPlan, smallTickets())
    expect(topic).toMatchObject({ sprint: 1, topic: 'Graphs: BFS and DFS', pattern: 'Graphs; Island (Matrix Traversal)', note: 'Templates first.', solved: 0, total: 3 })
    expect(topic.problems.map(p => p.id)).toEqual(['p200', 'p127', 'p1'])
    expect(topic.problems.map(p => p.ticket?.id)).toEqual(['p200', 'p127', 'p1'])
    expect(topic.problems[0].neetcode).toBe('https://neetcode.io/solutions/number-of-islands')
  })
  it('marks done tickets solved', () => {
    const [topic] = dsaTopics(smallPlan, mark(smallTickets(), ['p127'], { status: 'done' }))
    expect(topic.problems.map(p => p.solved)).toEqual([false, true, false])
    expect(topic.solved).toBe(1)
  })
  it('treats an archived ticket as no ticket: read-only and not solved (Review Focus #5)', () => {
    const [topic] = dsaTopics(smallPlan, mark(smallTickets(), ['p1'], { status: 'done', archived: true }))
    expect(topic.problems[2]).toMatchObject({ id: 'p1', ticket: null, solved: false })
    expect(topic.solved).toBe(0)
  })
  it('sorts non-contiguous topic sprints by sprint number, not file order (the bank has S16 before S15)', () => {
    const topics = dsaTopics(realPlan(), [])
    expect(topics.map(t => t.sprint)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 18, 20, 24])
    expect(Math.max(...topics.map(t => t.total))).toBe(13)
    expect(topics.flatMap(t => t.problems).every(p => p.neetcode !== null)).toBe(true)
  })
  it('sorts by sprint regardless of bank order (Review Focus)', () => {
    const plan = JSON.parse(JSON.stringify(smallPlan))
    plan.dsa_bank = [
      { sprint: 5, topic: 'Later', pattern: '', note: '', problems: [] },
      { sprint: 1, topic: 'Earlier', pattern: '', note: '', problems: [] },
      { sprint: 3, topic: 'Middle', pattern: '', note: '', problems: [] },
    ]
    expect(dsaTopics(plan, []).map(t => t.topic)).toEqual(['Earlier', 'Middle', 'Later'])
  })
})

describe('dsaTotals', () => {
  it('counts the live bank: 169 problems, 8/112/49 by difficulty, 9 premium left', () => {
    const plan = realPlan()
    const totals = dsaTotals(dsaTopics(plan, planToTickets(plan).map(newTicket)))
    expect(totals).toEqual({
      solved: 0, total: 169, hardSolved: 0, premiumLeft: 9,
      byDifficulty: { E: { solved: 0, total: 8 }, M: { solved: 0, total: 112 }, H: { solved: 0, total: 49 } },
    })
  })
  it('counts solved, hard solved and premium left', () => {
    const ts = mark(smallTickets(), ['p127', 'p1'], { status: 'done' })
    const plan = JSON.parse(JSON.stringify(smallPlan))
    plan.dsa_bank[0].problems[0].premium = true
    expect(dsaTotals(dsaTopics(plan, ts))).toEqual({
      solved: 2, total: 3, hardSolved: 1, premiumLeft: 1,
      byDifficulty: { E: { solved: 1, total: 1 }, M: { solved: 0, total: 1 }, H: { solved: 1, total: 1 } },
    })
  })
  it('excludes an archived premium problem from premiumLeft, but keeps it in total (A3)', () => {
    const ts = mark(smallTickets(), ['p1'], { archived: true })
    const plan = JSON.parse(JSON.stringify(smallPlan))
    plan.dsa_bank[0].problems[2].premium = true
    const totals = dsaTotals(dsaTopics(plan, ts))
    expect(totals.total).toBe(3)
    expect(totals.premiumLeft).toBe(0)
  })
})

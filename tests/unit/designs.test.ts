import { describe, expect, it } from 'vitest'
import { DONE_MEANS, RUBRIC, RUBRIC_TOTAL } from '../../src/content/designs'
import type { Ticket } from '../../src/data/types'
import { designCallout, designTiers, designTotals, nextDesign, tierLabel } from '../../src/rules/designs'
import { newTicket, planToTickets } from '../../src/rules/planTickets'
import { realPlan } from '../helpers/plan'

const plan = realPlan()
const fresh = () => planToTickets(plan).map(newTicket)
const mark = (ts: Ticket[], ids: string[], patch: Partial<Ticket>) => ts.map(t => (ids.includes(t.id) ? { ...t, ...patch } : t))
const allDesignIds = plan.design_bank.flatMap(t => t.items.map(i => i.id))

describe('designTiers', () => {
  it('derives six tiers with ranges from the tier names, joined to tickets', () => {
    const tiers = designTiers(plan, fresh())
    expect(tiers.map(t => [t.index, t.from, t.to])).toEqual([[1, 21, 24], [2, 25, 32], [3, 33, 36], [4, 37, 40], [5, 41, 44], [6, 45, 56]])
    expect(tiers.map(t => t.label)).toEqual([
      'Foundations', 'Core distributed systems', 'Hard classic designs', 'Data-heavy systems', 'ML platforms', 'LLM and agentic systems',
    ])
    expect(tiers[0].items[0]).toMatchObject({ id: 'd-method', tier: 1, done: false })
    expect(tiers[0].items[0].ticket?.plannedSprint).toBe(21)
    expect(tiers[0].items[0].deepDives).toHaveLength(4)
    expect(tiers.reduce((a, t) => a + t.total, 0)).toBe(48)
  })
  it('strips the sprint range from a tier name', () => {
    expect(tierLabel('Foundations (sprints 21 to 24)')).toBe('Foundations')
    expect(tierLabel('No range here')).toBe('No range here')
  })
})

describe('designTotals', () => {
  it('counts done, deep dives covered (done × 4) and difficulty; archived excluded', () => {
    const ts = mark(mark(fresh(), ['d-method', 'd-estimate', 'd-kv'], { status: 'done' }), ['d-kv'], { archived: true })
    const totals = designTotals(designTiers(plan, ts))
    expect(totals.done).toBe(2)
    expect(totals.total).toBe(48)
    expect(totals.deepDivesCovered).toBe(8)
    expect(totals.byDifficulty.M.done).toBe(2)
  })
})

describe('nextDesign and designCallout (Review Focus #5)', () => {
  it('before the design window: no item, "Design bank starts S21"', () => {
    const tiers = designTiers(plan, fresh())
    expect(nextDesign(tiers, 0)).toBeNull()
    expect(nextDesign(tiers, 20)).toBeNull()
    expect(designCallout(tiers, 20)).toEqual({ kind: 'before', text: 'Design bank starts S21' })
  })
  it('inside the window: first undone item of the tier covering the sprint', () => {
    expect(nextDesign(designTiers(plan, fresh()), 21)?.id).toBe('d-method')
    expect(nextDesign(designTiers(plan, mark(fresh(), ['d-method'], { status: 'done' })), 21)?.id).toBe('d-estimate')
    expect(nextDesign(designTiers(plan, fresh()), 25)?.id).toBe('d-kv')
    const callout = designCallout(designTiers(plan, fresh()), 25)
    expect(callout.kind === 'next' && callout.tier.index).toBe(2)
  })
  it('a finished tier falls through to the next tier', () => {
    const tier1 = plan.design_bank[0].items.map(i => i.id)
    expect(nextDesign(designTiers(plan, mark(fresh(), tier1, { status: 'done' })), 22)?.id).toBe('d-kv')
  })
  it('after the window: first undone anywhere, then "All 48 done"', () => {
    expect(nextDesign(designTiers(plan, fresh()), 57)?.id).toBe('d-method')
    const all = designTiers(plan, mark(fresh(), allDesignIds, { status: 'done' }))
    expect(nextDesign(all, 57)).toBeNull()
    expect(designCallout(all, 57)).toEqual({ kind: 'all-done', text: 'All 48 done' })
  })
  it('no design bank: "No design bank in this plan"', () => {
    expect(designCallout([], 30)).toEqual({ kind: 'none', text: 'No design bank in this plan' })
  })
})

describe('design content', () => {
  it('rubric is five items summing to 20 points', () => {
    expect(RUBRIC.map(r => [r.item, r.points])).toEqual([
      ['Requirements and numbers', 4],
      ['API and data model', 3],
      ['High-level design meeting the numbers', 4],
      ['Two deep dives with real trade-offs', 6],
      ['Failure modes and operations', 3],
    ])
    expect(RUBRIC.reduce((a, r) => a + r.points, 0)).toBe(RUBRIC_TOTAL)
    expect(RUBRIC_TOTAL).toBe(20)
    expect(DONE_MEANS).toContain('45 minutes on a whiteboard or a recording')
  })
})

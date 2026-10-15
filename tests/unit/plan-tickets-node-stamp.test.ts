import { describe, expect, it } from 'vitest'
import { planToTickets } from '../../src/rules/planTickets'
import { realPlanV2, smallPlanV2 } from '../helpers/plan'

describe('planToTickets stamps node and area on bank tickets (TREE-03)', () => {
  it('every p<num> and design-item ticket carries its bank entry node and that node area', () => {
    const plan = realPlanV2()
    const out = planToTickets(plan)
    const areaOf = new Map(plan.nodes.map(n => [n.id, n.area]))
    let dsa = 0
    let design = 0
    for (const w of plan.dsa_bank) for (const p of w.problems) {
      const t = out.find(x => x.id === `p${p.num}`)!
      expect(t.node).toBe((p as { node?: string }).node)
      expect(t.area).toBe('dsa')
      expect(areaOf.get(t.node!)).toBe('dsa')
      dsa++
    }
    for (const tier of plan.design_bank) for (const it of tier.items) {
      const t = out.find(x => x.id === it.id)!
      expect(t.node).toBe((it as { node?: string }).node)
      expect(t.area).toBe('design')
      expect(areaOf.get(t.node!)).toBe('design')
      design++
    }
    expect(dsa).toBe(plan.dsa_bank.reduce((n, w) => n + w.problems.length, 0))
    expect(design).toBe(plan.design_bank.reduce((n, t) => n + t.items.length, 0))
    expect(dsa).toBeGreaterThan(0)
    expect(design).toBeGreaterThan(0)
  })

  it('a bank entry without a node gets neither field (bank tickets and old plans stay node-less)', () => {
    const out = planToTickets(smallPlanV2)
    const p = out.find(t => t.id === 'p200')!
    expect('node' in p).toBe(false)
    expect('area' in p).toBe(false)
  })
})

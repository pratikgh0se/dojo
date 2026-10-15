import { describe, expect, it } from 'vitest'
import { CONTENT_KEYS, LEARNER_KEYS, PlanDataError, paceOrder, planToTickets } from '../../src/rules/planTickets'
import type { PlanV2 } from '../../src/data/planV2'
import { flatPlanV2 } from '../helpers/plan'

const clone = (): PlanV2 => JSON.parse(JSON.stringify(flatPlanV2)) as PlanV2

describe('planToTickets(plan v2)', () => {
  const c = planToTickets(flatPlanV2)
  const by = (id: string) => c.find(x => x.id === id)!

  it('emits path tickets, bank tickets and tasks with a lane each', () => {
    expect(c).toHaveLength(10)
    expect(Object.fromEntries(c.map(x => [x.id, x.lane]))).toEqual({
      m1w1t1: 'path', m1w2t1: 'path', m1w3t1: 'path', p200: 'dsa', p127: 'dsa', p1: 'dsa',
      'd-method': 'design', 'd-estimate': 'design', m1w1i1: 'dsa', m1w2i1: 'career',
    })
  })
  it('copies the v2 fields and fixes the flat-model defaults', () => {
    expect(by('m1w1t1')).toMatchObject({ origin: 'plan', track: 'ai', kind: 'watch', node: 't01', area: 'a1', phase: 1, estMin: 45, order: 1, plannedSprint: 1, explain: ['What is a token?'], explainAnswers: ['The unit of text a model reads and writes.'], asOf: '2026-10-11' })
    expect(by('m1w2t1').lab).toEqual({ id: 'b1', gpu: 'none' })
    expect(by('p200')).toMatchObject({ kind: 'problem', title: '200 · Number of Islands', estMin: 30, skill: 'dsa', pattern: 'graphs', difficulty: 'M', order: 2, track: 'interview' })
    expect(by('d-method')).toMatchObject({ kind: 'design', estMin: 45, skill: 'sysd', order: 5 })
  })
  it('orders are unique and the lanes interleave', () => {
    const orders = c.map(x => x.order)
    expect(new Set(orders).size).toBe(orders.length)
    expect(c.slice().sort((a, b) => a.order - b.order).map(x => x.lane).slice(0, 4)).toEqual(['path', 'dsa', 'path', 'dsa'])
  })
  it('does not copy arrays by reference', () => {
    expect(by('m1w1t1').links).not.toBe(flatPlanV2.tickets[0].links)
  })
  it('refuses a malformed plan whole: duplicate ids, duplicate orders, missing fields', () => {
    const dupId = clone(); dupId.tasks[0].id = 'm1w1t1'
    expect(() => planToTickets(dupId)).toThrow(PlanDataError)
    const dupOrder = clone(); dupOrder.tasks[0].order = 1
    expect(() => planToTickets(dupOrder)).toThrow(/duplicate order/)
    const noLinks = clone(); delete (noLinks.tickets[0] as { links?: unknown }).links
    expect(() => planToTickets(noLinks)).toThrow(PlanDataError)
  })
  it('stamps bank orders from the lane share when the generator did not (fallback)', () => {
    const p = clone()
    for (const w of p.dsa_bank as { problems: { order?: number }[] }[]) for (const x of w.problems) delete x.order
    const r = planToTickets(p).filter(x => x.lane === 'dsa' && x.kind === 'problem')
    expect(r.map(x => x.order)).toEqual([paceOrder(0, 25, 0), paceOrder(30, 25, 1), paceOrder(60, 25, 2)])
    expect(new Set(planToTickets(p).map(x => x.order)).size).toBe(10)
  })
  it('refreshable content never includes the user-local order', () => {
    expect(CONTENT_KEYS).toEqual(expect.arrayContaining(['lane', 'node', 'area', 'phase', 'explain', 'explainAnswers', 'lab', 'asOf', 'order']))
    expect(CONTENT_KEYS as readonly string[]).not.toContain('orderOverride')
    for (const k of LEARNER_KEYS) expect(CONTENT_KEYS as readonly string[], k).not.toContain(k)
  })
  it('lists every learner-owned key and none of them is plan content', () => {
    expect([...LEARNER_KEYS].sort()).toEqual(['explainResponses', 'learnerNotes', 'learnerUpdatedAt', 'selfMark'])
    for (const k of ['learnerNotes', 'explainResponses', 'selfMark', 'learnerUpdatedAt', 'orderOverride']) {
      expect(CONTENT_KEYS as readonly string[], k).not.toContain(k)
    }
  })

  describe('fix round 1: unique fallback orders and finite guards', () => {
    const unstamp = (p: PlanV2): PlanV2 => {
      for (const w of p.dsa_bank as { problems: { order?: number }[] }[]) for (const x of w.problems) delete x.order
      for (const t of p.design_bank as { items: { order?: number }[] }[]) for (const x of t.items) delete x.order
      return p
    }
    it('with neither bank stamped every order is unique and the plan loads (lane salt)', () => {
      const r = planToTickets(unstamp(clone()))
      expect(new Set(r.map(x => x.order)).size).toBe(r.length)
      // deterministic
      expect(planToTickets(unstamp(clone())).map(x => x.order)).toEqual(r.map(x => x.order))
      // first dsa and first design fallbacks sit at the same ideal-pace position yet differ
      const d0 = r.find(x => x.id === 'p200')!.order
      const g0 = r.find(x => x.id === 'd-method')!.order
      expect(d0).not.toBe(g0)
      expect(Math.abs(d0 - g0)).toBeLessThan(1e-3)
    })
    it('stamped bank orders stay authoritative while the other bank falls back', () => {
      const p = clone()
      for (const t of p.design_bank as { items: { order?: number }[] }[]) for (const x of t.items) delete x.order
      const r = planToTickets(p)
      expect(r.find(x => x.id === 'p200')!.order).toBe(2)
      expect(new Set(r.map(x => x.order)).size).toBe(r.length)
    })
    it('refuses a non-finite or non-number order or estMin on any v2 ticket or bank entry', () => {
      for (const bad of [NaN, Infinity, '5' as unknown as number]) {
        const a = clone(); a.tickets[0].order = bad
        expect(() => planToTickets(a)).toThrow(PlanDataError)
        const b = clone(); b.tasks[0].estMin = bad
        expect(() => planToTickets(b)).toThrow(PlanDataError)
        const c1 = clone(); (c1.dsa_bank as { problems: { order?: number }[] }[])[0].problems[0].order = bad
        expect(() => planToTickets(c1)).toThrow(PlanDataError)
        const c2 = clone(); (c2.dsa_bank as { problems: { estMin?: number }[] }[])[0].problems[0].estMin = bad
        expect(() => planToTickets(c2)).toThrow(PlanDataError)
        const d1 = clone(); (d1.design_bank as { items: { order?: number }[] }[])[0].items[0].order = bad
        expect(() => planToTickets(d1)).toThrow(PlanDataError)
        const d2 = clone(); (d2.design_bank as { items: { estMin?: number }[] }[])[0].items[0].estMin = bad
        expect(() => planToTickets(d2)).toThrow(PlanDataError)
      }
    })
    it('a missing mix share is a PlanDataError when a fallback order needs it, never NaN', () => {
      const p = unstamp(clone())
      delete (p.mix.shares as { dsa?: number }).dsa
      expect(() => planToTickets(p)).toThrow(/mix\.shares\.dsa/)
      const q = unstamp(clone())
      delete (q.mix.shares as { design?: number }).design
      expect(() => planToTickets(q)).toThrow(/mix\.shares\.design/)
      // fully stamped banks never need a share
      const r = clone()
      delete (r.mix.shares as { dsa?: number }).dsa
      expect(() => planToTickets(r)).not.toThrow()
    })
    it('refuses a stamped estMin outside 15 to 120 minutes', () => {
      for (const bad of [14, 121, 0, -5]) {
        const a = clone(); a.tickets[0].estMin = bad
        expect(() => planToTickets(a)).toThrow(PlanDataError)
        const b = clone(); (b.dsa_bank as { problems: { estMin?: number }[] }[])[0].problems[0].estMin = bad
        expect(() => planToTickets(b)).toThrow(PlanDataError)
      }
      const ok = clone(); ok.tickets[0].estMin = 15; ok.tasks[0].estMin = 120
      expect(() => planToTickets(ok)).not.toThrow()
    })
  })
})

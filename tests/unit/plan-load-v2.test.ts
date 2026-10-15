import { describe, expect, it } from 'vitest'
import { getSettings } from '../../src/data/db'
import { loadPlan, runReconcile } from '../../src/data/seed'
import { isPlanV2 } from '../../src/data/planV2'
import { PlanDataError, assertPlanV2Shape, planToTickets, newTicket } from '../../src/rules/planTickets'
import { resolveLearnerLinks } from '../../src/rules/learnerLinks'
import { possibleXp } from '../../src/rules/xp'
import { freshDb } from '../helpers/db'
import { flatPlanV2, smallPlanV2 } from '../helpers/plan'

const serve = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('loading and seeding a plan v2', () => {
  it('loadPlan accepts v2 and still accepts v1', async () => {
    const v2 = await loadPlan(serve(smallPlanV2))
    // R1: loadPlan hands the forge-era screens a shim in `plan` and the v2 plan itself in `v2`
    expect(v2.ok && isPlanV2(v2.v2)).toBe(true)
    expect(v2.ok && !isPlanV2(v2.plan)).toBe(true)
    expect((await loadPlan(serve(flatPlanV2))).ok).toBe(true)
  })

  it('loadPlan says what it expected when the file is neither', async () => {
    const r = await loadPlan(serve({ hello: 1 }))
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/is not a plan v2 \(planFormat 2\)/) })
  })

  it('seeds every v2 ticket once, records the plan version, and a second boot writes nothing', async () => {
    const d = freshDb()
    await runReconcile(d, smallPlanV2)
    expect(await d.tickets.count()).toBe(16)
    const before = await d.tickets.orderBy('id').toArray()
    expect(await getSettings(d)).toMatchObject({ planVersion: 'fx-v2-2026-10-12', possibleXp: possibleXp(planToTickets(smallPlanV2).map(newTicket)) })
    await runReconcile(d, smallPlanV2)
    expect(await d.tickets.orderBy('id').toArray()).toEqual(before)
    expect(await d.events.count()).toBe(0)
  })

  it('resolves {{learner.*}} links on a v2 plan: dropped when unset, filled when set', () => {
    const plan = structuredClone(smallPlanV2)
    const link = { label: 'my notes', url: '{{learner.patternsRepo}}' }
    plan.tickets[0].links.push(link)
    plan.tasks[0].links.push(link)
    plan.design_bank[0].items[0].refs.push(link)
    const count = (p: typeof plan, url: string) =>
      [...p.tickets, ...p.tasks, ...p.design_bank.flatMap(t => t.items.map(i => ({ links: i.refs })))].flatMap(t => t.links).filter(l => l.url === url).length
    expect(count(plan, '{{learner.patternsRepo}}')).toBe(3)
    expect(count(resolveLearnerLinks(plan), '{{learner.patternsRepo}}')).toBe(0)
    expect(count(resolveLearnerLinks({ ...plan, learner: { patternsRepo: 'https://example.com/me' } }), 'https://example.com/me')).toBe(3)
  })

  describe('a planFormat 2 plan with a missing or mistyped part is an error card, never a TypeError', () => {
    const broken = (mutate: (p: Record<string, any>) => void) => {
      const p = structuredClone(smallPlanV2) as unknown as Record<string, any>
      mutate(p)
      return p
    }
    const cases: [string, (p: Record<string, any>) => void, RegExp][] = [
      ['no tasks', p => { delete p.tasks }, /tasks must be an array/],
      ['no dsa_bank', p => { delete p.dsa_bank }, /dsa_bank must be an array/],
      ['no design_bank', p => { delete p.design_bank }, /design_bank must be an array/],
      ['a ticket whose links is not an array', p => { p.tickets[0].links = 'x' }, /links must be an array/],
      ['a task whose links is not an array', p => { p.tasks[0].links = {} }, /links must be an array/],
      ['a design item whose refs is not an array', p => { p.design_bank[0].items[0].refs = 'x' }, /refs must be an array/],
      ['mix.budgets not an array', p => { p.mix.budgets = 'x' }, /budgets must be 7 numbers/],
      ['mix.budgets of the wrong length', p => { p.mix.budgets = [1, 2, 3] }, /budgets must be 7 numbers/],
    ]
    it.each(cases)('loadPlan reports %s as a plan error', async (_n, mutate, msg) => {
      // loadPlan's contract: every bad file is { ok: false, error }, which App shows as the plan error card (a throw would hang boot)
      const r = await loadPlan(serve(broken(mutate)))
      expect(r).toEqual({ ok: false, error: expect.stringMatching(msg) })
    })
    it.each(cases)('assertPlanV2Shape throws a PlanDataError for %s', (_n, mutate, msg) => {
      const p = broken(mutate)
      expect(() => assertPlanV2Shape(p as never)).toThrow(PlanDataError)
      expect(() => assertPlanV2Shape(p as never)).toThrow(msg)
      expect(() => planToTickets(p as never)).toThrow(PlanDataError)
    })
    it('resolveLearnerLinks tolerates absent optional arrays on a v2 plan', () => {
      const p = broken(q => { delete q.tasks; delete q.tickets[0].links; q.design_bank[0].items[0].refs = undefined })
      expect(() => resolveLearnerLinks(p as never)).not.toThrow()
    })
    it('a good plan passes the check', () => {
      expect(() => assertPlanV2Shape(smallPlanV2)).not.toThrow()
    })
  })
})

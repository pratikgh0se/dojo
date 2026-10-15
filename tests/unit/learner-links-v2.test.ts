import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PlanV2 } from '../../src/data/planV2'
import { resolveLearnerLinks } from '../../src/rules/learnerLinks'
import * as learnerLinks from '../../src/rules/learnerLinks'
import { realPlanV2 } from '../helpers/plan'

const PLACEHOLDER = '{{learner.patternsRepo}}'
/** How many links (objects with a `url`) carry exactly this url; the plan's own `learner` block is not a link. */
const count = (v: unknown, url: string) => (JSON.stringify(v).split(`"url":${JSON.stringify(url)}`).length - 1)
const readPlan = (rel: string): PlanV2 => JSON.parse(readFileSync(resolve(process.cwd(), rel), 'utf8')) as PlanV2

// The private edition ships public/data-private/plan.json; the public tree has only public/data/plan.json.
const plans: [string, () => PlanV2][] = [['public/data/plan.json', () => realPlanV2()]]
if (existsSync(resolve(process.cwd(), 'public/data-private/plan.json'))) plans.push(['public/data-private/plan.json', () => readPlan('public/data-private/plan.json')])

describe('resolveLearnerLinks is the one resolver, for either plan format (R6)', () => {
  it('has no separate v2 variant', () => {
    expect((learnerLinks as Record<string, unknown>).resolveLearnerLinksV2).toBeUndefined()
  })

  it.each(plans)('the three {{learner.patternsRepo}} placeholders of the real plan %s resolve', (_name, load) => {
    const plan = load()
    expect(count(plan, PLACEHOLDER)).toBe(3)
    expect(count(resolveLearnerLinks(plan), PLACEHOLDER)).toBe(0)
    const own = resolveLearnerLinks({ ...plan, learner: { patternsRepo: 'https://example.com/me' } })
    expect(count(own, PLACEHOLDER)).toBe(0)
    expect(count(own, 'https://example.com/me')).toBe(3)
  })

  describe('a v2 plan missing parts does not throw', () => {
    const base = () => structuredClone(realPlanV2()) as unknown as Record<string, unknown>
    it.each([
      ['no tasks', (p: Record<string, unknown>) => { delete p.tasks }],
      ['no design_bank', (p: Record<string, unknown>) => { delete p.design_bank }],
      ['design_bank not an array', (p: Record<string, unknown>) => { p.design_bank = 'x' }],
      ['a ticket without links', (p: Record<string, unknown>) => { delete (p.tickets as { links?: unknown }[])[0].links }],
      ['a design tier without items', (p: Record<string, unknown>) => { delete (p.design_bank as { items?: unknown }[])[0].items }],
      ['a design item without refs', (p: Record<string, unknown>) => { (p.design_bank as { items: { refs?: unknown }[] }[])[0].items[0].refs = undefined }],
      ['null rows', (p: Record<string, unknown>) => { (p.tasks as unknown[])[0] = null; (p.tickets as unknown[])[0] = null }],
    ])('%s', (_n, mutate) => {
      const p = base()
      mutate(p)
      expect(() => resolveLearnerLinks(p as never)).not.toThrow()
    })
    it('the missing part stays missing (the loader reports it)', () => {
      const p = base()
      delete p.tasks
      expect('tasks' in (resolveLearnerLinks(p as never) as object) && (resolveLearnerLinks(p as never) as { tasks?: unknown }).tasks).toBeFalsy()
    })
  })
})

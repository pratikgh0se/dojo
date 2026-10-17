import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PlanV2 } from '../../src/data/planV2'
import { paceLine, projectedEnd } from '../../src/rules/pace'
import { newTicket, planToTickets } from '../../src/rules/planTickets'

// SET-02: on a fresh plan starting 2026-11-02 with the default budgets, the pace line reads February or March 2028.
// The nodes of phases that are not written yet carry planning `hours`; this fails if a plan edit drops them or moves the end date.
const readPlan = (p: string): PlanV2 => JSON.parse(readFileSync(resolve(process.cwd(), p), 'utf8')) as PlanV2
const plans: Array<[string, string]> = [['public/data/plan.json', 'public edition']]
if (existsSync(resolve(process.cwd(), 'public/data-private/plan.json'))) plans.push(['public/data-private/plan.json', 'private edition'])

const NOV2 = new Date(2026, 10, 2).getTime()
const DEFAULT_BUDGETS = [90, 60, 60, 60, 30, 30, 150]

describe.each(plans)('pace projection on the shipped plan: %s (%s)', (file) => {
  const plan = readPlan(file)
  const projection = projectedEnd({ tickets: planToTickets(plan).map(newTicket), nodes: plan.nodes, phases: plan.phases, budgets: DEFAULT_BUDGETS, careerLane: false, now: NOV2 })

  it('day one ends in February or March 2028 (SET-02)', () => {
    expect(['February 2028', 'March 2028']).toContain(projection.label)
    expect(paceLine(projection)).toMatch(/^at this pace the plan ends about (February|March) 2028$/)
  })
  it('counts the planning hours of every node in phases 3 to 6', () => {
    const open = plan.phases.filter(p => !p.authored).map(p => p.p)
    expect(open).toEqual([3, 4, 5, 6])
    for (const n of plan.nodes.filter(n => open.includes(n.phase) && n.kind !== 'band')) expect(n.hours, `node ${n.id}`).toBeGreaterThan(0)
    expect(projection.unwrittenMin).toBe(230 * 60)
  })
})

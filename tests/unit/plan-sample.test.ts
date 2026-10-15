import { describe, expect, it } from 'vitest'
import { isPlanV2 } from '../../src/data/planV2'
import { planToTickets } from '../../src/rules/planTickets'
import { getSettings } from '../../src/data/db'
import { runReconcile } from '../../src/data/seed'
import { realPlanV2 } from '../helpers/plan'
import { freshDb } from '../helpers/db'

describe('the shipped sample plan', () => {
  const plan = realPlanV2()
  const c = planToTickets(plan)

  it('is plan v2 with the 12 areas (10 AI plus DSA and design), 6 phases and 113 emitted nodes', () => {
    // 116 nodes in plan-src (77 AI and band, 17 DSA, 22 design); the band nodes U0, U7 and D1 are not emitted (carry ruling R-A1).
    expect(isPlanV2(plan)).toBe(true)
    expect([plan.areas.length, plan.phases.length, plan.nodes.length, plan.builds.length]).toEqual([12, 6, 113, 7])
    expect(plan.planVersion).toMatch(/^ai-infra-v1-\d{4}-\d{2}-\d{2}$/)
  })

  it('carries 113 kept tasks, 170 problems and 48 design items, all with unique ids and unique orders', () => {
    expect(plan.tasks).toHaveLength(113)
    expect(c.filter(t => t.kind === 'problem')).toHaveLength(170)
    expect(c.filter(t => t.kind === 'design')).toHaveLength(48)
    expect(new Set(c.map(t => t.id)).size).toBe(c.length)
    expect(new Set(c.map(t => t.order)).size).toBe(c.length)
    expect(c.length).toBe(plan.tickets.length + 113 + 170 + 48)
  })

  it('has no stage ticket, no title cut with an ellipsis and no ticket outside one sitting', () => {
    expect(c.some(t => t.kind === 'stage')).toBe(false)
    expect(c.some(t => t.title.endsWith('…'))).toBe(false)
    expect(c.every(t => t.estMin >= 15 && t.estMin <= 120)).toBe(true)
  })

  it('says a phase is authored exactly when it has tickets, and the queue then starts with an authored AI ticket that has a node', () => {
    for (const p of plan.phases) expect(p.authored, `phase ${p.p}`).toBe(plan.tickets.some(t => t.phase === p.p))
    if (plan.tickets.length > 0) {
      expect(c[0]).toMatchObject({ lane: 'path', track: 'ai' })
      expect(c[0].node).toBeTruthy()
    }
  })

  it('shows the word "interview" nowhere in plan text except inside Hello Interview and interviewing.io (contract GLOBAL-01)', () => {
    const allowed = (t: string) => t.replace(/Hello Interview/gi, '').replace(/interviewing\.io/gi, '')
    const texts = [
      ...c.flatMap(t => [t.title, t.text ?? '']),
      ...plan.nodes.flatMap(n => [n.title, n.oneLiner, n.why, ...n.explain]),
    ]
    expect(texts.filter(t => /\binterview/i.test(allowed(t)))).toEqual([])
  })

  it('keeps the three {{learner.patternsRepo}} placeholders in the sample', () => {
    expect(JSON.stringify(plan).match(/\{\{learner\.patternsRepo\}\}/g)).toHaveLength(3)
  })
})

describe('seeding the shipped sample plan', () => {
  it('seeds every ticket once and records the plan version', async () => {
    const d = freshDb()
    const plan = realPlanV2()
    await runReconcile(d, plan)
    expect(await d.tickets.count()).toBe(plan.tickets.length + 113 + 170 + 48)
    expect((await getSettings(d)).planVersion).toBe(plan.planVersion)
  })
})

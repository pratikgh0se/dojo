import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PlanJson, StageSession } from '../../src/data/types'
import type { PlanV2 } from '../../src/data/planV2'
import smallV2 from '../fixtures/plan.small.v2.json'
import flatV2 from '../fixtures/plan.flat.v2.json'

/** The small plan in plan v2, generated from tests/fixtures/plan-src-small (see Task 9 of the S1 plan for the command). */
export const smallPlanV2 = smallV2 as unknown as PlanV2

/** S2's hand-written flat-queue plan v2 fixture with the ten ids of the retired v1 small plan (m1w1t1 watch, m1w2t1 build, m1w3t1 read, m1w1i1, m1w2i1, p200, p127, p1, d-method, d-estimate), all path/dsa/design/career lanes; FX-LEGACY's dojo.db is built against it. */
export const flatPlanV2 = flatV2 as unknown as PlanV2

/** The shipped sample plan (public/data/plan.json) as plan v2. */
export function realPlanV2(): PlanV2 {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/plan.json'), 'utf8')) as PlanV2
}

/**
 * flatPlanV2 with the bank prose of the retired v1 small plan (topic and pattern names, design titles, deep dives and refs).
 * The screen tests that assert on that wording use it; ids, lanes and `order` are the flat fixture's.
 */
export const flatPlanProse: PlanV2 = (() => {
  const p = structuredClone(flatPlanV2)
  const dsa = p.dsa_bank[0]
  dsa.topic = 'Graphs: BFS and DFS'
  dsa.pattern = 'Graphs; Island (Matrix Traversal)'
  dsa.note = 'Templates first.'
  const slug: Record<number, string> = { 200: 'number-of-islands', 127: 'word-ladder', 1: 'two-sum' }
  for (const q of dsa.problems) q.url = `https://leetcode.com/problems/${slug[q.num]}/`
  const [method, estimate] = p.design_bank[0].items
  method.title = 'The method, on a whiteboard, in 45 minutes'
  method.deep_dives = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
  method.refs = [{ label: 'Hello Interview free guides', url: 'https://example.com/hello' }]
  estimate.title = 'Back-of-envelope sheet'
  estimate.deep_dives = ['Latency', 'Throughput', 'Storage', 'Cost']
  estimate.refs = [{ label: 'System Design Primer', url: 'https://example.com/sdp' }]
  return p
})()

/** The shipped sample plan (plan v2). Kept under the old name for the bank, atlas and DSA tests, which read `dsa_bank` and `design_bank`. */
export function realPlan(): PlanV2 {
  return realPlanV2()
}

/** The v1 (forge-era) plan shape, kept in tests only: the frozen fixture and the stage-band helper read it. No src code reads it. */
export interface LegacyTask {
  id: string; skill: string; text: string; links: { label: string; url: string }[]; kind?: 'task' | 'stage' | 'watch' | 'read'
  stage?: number; session?: StageSession
}
export interface LegacySprint {
  sprint: number; block: number; block_title: string; block_theme: string; focus_ai: string; focus_interview: string
  ai: LegacyTask[]; interview: LegacyTask[]; proof: string | null
}
export interface LegacyForgePlan extends PlanJson {
  generated?: string; sprint_days: number; total_sprints: number; sprints: LegacySprint[]
  communities?: { n: string; k: string; u: string; fit: string; how: string; lane: string }[]
  ai_shelf?: { skill: string; text: string; links: { label: string; url: string }[]; from?: string }[]
}

/** The frozen forge-era plan (planVersion forge-v0-2026-10-05, public wording): 650 tickets, 288 of them stage tickets. */
export function legacyForgePlan(): LegacyForgePlan {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'tests/fixtures/plan.legacy-forge.json'), 'utf8')) as LegacyForgePlan
}

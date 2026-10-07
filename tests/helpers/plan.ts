import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PlanJson } from '../../src/data/types'
import small from '../fixtures/plan.small.json'

export const smallPlan = small as unknown as PlanJson

export function realPlan(): PlanJson {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'public/data/plan.json'), 'utf8')) as PlanJson
}

/**
 * Frozen pre-forge-rewrite plan (planVersion '2026-09-05'), extracted before
 * scripts/rewrite_ai_track.mjs replaced the AI track with forge stage tickets.
 * Tests pinned to old-plan content (counts, ids, XP totals) load this instead
 * of realPlan() so they keep testing mechanics, not today's live plan data.
 */
export function legacyPlan(): PlanJson {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'tests/fixtures/plan.legacy-2026-09-05.json'), 'utf8'),
  ) as PlanJson
}

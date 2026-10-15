// Which Atlas pattern does a problem belong to (ATLAS-08, ATLAS-09, TREE-17). One pure lookup; the Atlas rows, the
// /dsa pattern chip and the Skills tree chip all call it, so a chip always lands on a row that lists the problem.
import { APPROACHES, type Approach } from '../content/approaches'
import { patternBySlug } from '../content/atlas'
import { ATLAS_LENS } from '../content/atlasTags'
import type { PlanJson } from '../data/types'

export interface PatternRef { slug: string; label: string }

/**
 * Every row that lists the problem, in tag order: the pattern of its starred best way first, then its other ways in
 * the order they are listed (brute to best), then lens tags. No repeats. Unknown ids give [].
 */
export function patternSlugsOfProblem(
  problemId: string,
  approaches: Readonly<Record<string, readonly Approach[]>> = APPROACHES,
  lens: Readonly<Record<string, readonly string[]>> = ATLAS_LENS,
): string[] {
  const ways = approaches[problemId] ?? []
  const ordered = [...ways.filter(a => a.best), ...ways.filter(a => !a.best)].map(a => a.pattern)
  for (const [slug, ids] of Object.entries(lens)) if (ids.includes(problemId)) ordered.push(slug)
  return [...new Set(ordered)].filter(slug => patternBySlug(slug))
}

/**
 * The problem's first-tagged pattern, `{slug, label}`, or null when the plan has no such DSA problem or nothing tags it.
 * `problemId` is the ticket id, `p<num>`.
 */
export function patternForProblem(
  problemId: string,
  plan: Pick<PlanJson, 'dsa_bank'>,
  approaches: Readonly<Record<string, readonly Approach[]>> = APPROACHES,
  lens: Readonly<Record<string, readonly string[]>> = ATLAS_LENS,
): PatternRef | null {
  const m = /^p(\d+)$/.exec(problemId)
  if (!m || !plan.dsa_bank.some(w => w.problems.some(p => p.num === Number(m[1])))) return null
  const slug = patternSlugsOfProblem(problemId, approaches, lens)[0]
  const pattern = slug ? patternBySlug(slug) : undefined
  return pattern ? { slug: pattern.slug, label: pattern.label } : null
}

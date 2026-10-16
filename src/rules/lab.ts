// Lab rules (R2 W1): which milestones are passed, the lab's status, and the guard for a run the server sent back.
// Pure: no React, no Dexie. Nothing here is stored; milestone and lab status are computed from labs, labRuns and labReviews.
import type { LabResults, LabReviewRow, LabRow, LabRunRow, Settings } from '../data/types'

export const DEFAULT_LABS_ROOT = '~/labs'

/** The labs folder Settings holds, as typed; `~/labs` when empty or absent. */
export const labsRootOf = (s: Pick<Settings, 'labsRoot'> | undefined): string => s?.labsRoot?.trim() || DEFAULT_LABS_ROOT

/** One ticket's part of a lab definition (`GET /labs/info` `milestones[]`). */
export interface LabMilestone { ticket: string; checkIds: readonly string[] }

/**
 * A milestone is PASSED when some stored run (of its lab: pass the lab's runs) has every one of its check ids at `pass`.
 * Monotonic on purpose: a later run that breaks an early check does not un-pass the milestone.
 */
export function milestonePassed(milestone: Pick<LabMilestone, 'checkIds'>, runs: readonly LabRunRow[]): boolean {
  if (milestone.checkIds.length === 0) return false
  return runs.some(r => r.results !== null && milestone.checkIds.every(id => r.results!.checks.some(c => c.id === id && c.status === 'pass')))
}

/** True when the lab has milestones and every one is passed (the review is available then, ruling R-1). */
export function allMilestonesPassed(milestones: readonly LabMilestone[], runs: readonly LabRunRow[]): boolean {
  return milestones.length > 0 && milestones.every(m => milestonePassed(m, runs))
}

/** The newest row by `at` (ties: the later in the list), or undefined. */
function newest<T extends { at: number }>(rows: readonly T[]): T | undefined {
  return rows.reduce<T | undefined>((best, r) => (best === undefined || r.at >= best.at ? r : best), undefined)
}
/** The newest run, whatever happened in it. */
export const latestRun = (runs: readonly LabRunRow[]): LabRunRow | undefined => newest(runs)
/** The newest run that produced results (what the review sends to the AI). */
export const latestResultsRun = (runs: readonly LabRunRow[]): LabRunRow | undefined => newest(runs.filter(r => r.results !== null))
/** The lab's review: the newest `labReviews` row by `at`; on a tie the greater `id`. This is the one Proven rule. */
export const latestReview = (reviews: readonly LabReviewRow[]): LabReviewRow | undefined =>
  reviews.reduce<LabReviewRow | undefined>((best, r) => (best === undefined || r.at > best.at || (r.at === best.at && r.id > best.id) ? r : best), undefined)
/** Proven: the newest review passed. */
export const isProven = (reviews: readonly LabReviewRow[]): boolean => latestReview(reviews)?.passed === true

/**
 * `not_set_up`: no `labs` row. `building`: set up, some milestone not passed. `ready`: every milestone passed and the newest
 * review (if any) did not pass, so a review can be requested. `proven`: the newest review passed.
 */
export type LabStatus = 'not_set_up' | 'building' | 'ready' | 'proven'
export function labStatus(a: {
  lab: Pick<LabRow, 'labId'> | null | undefined
  milestones: readonly LabMilestone[]
  runs: readonly LabRunRow[]
  reviews: readonly LabReviewRow[]
}): LabStatus {
  if (!a.lab) return 'not_set_up'
  if (isProven(a.reviews)) return 'proven'
  return allMilestonesPassed(a.milestones, a.runs) ? 'ready' : 'building'
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The results of a run as the server sent them, or null when they are not the agreed shape (the guard before a run is stored). */
export function readResults(v: unknown): LabResults | null {
  if (!isObj(v) || !Array.isArray(v.checks) || !isObj(v.summary)) return null
  const checks: LabResults['checks'] = []
  for (const c of v.checks) {
    if (!isObj(c) || typeof c.id !== 'string' || typeof c.name !== 'string' || typeof c.detail !== 'string') return null
    if (c.status !== 'pass' && c.status !== 'fail' && c.status !== 'skip') return null
    checks.push({ id: c.id, name: c.name, status: c.status, detail: c.detail, ...(isObj(c.metrics) ? { metrics: c.metrics } : {}) })
  }
  const count = (s: string) => checks.filter(c => c.status === s).length
  return { checks, summary: { pass: count('pass'), fail: count('fail'), skip: count('skip') } }
}

/** A run reply (`POST /labs/run` `run`) as the fields of a `labRuns` row without id and labId, or null when it is malformed. */
export function readRun(v: unknown): Omit<LabRunRow, 'id' | 'labId'> | null {
  if (!isObj(v) || typeof v.at !== 'number' || typeof v.ms !== 'number' || typeof v.timedOut !== 'boolean' || typeof v.tail !== 'string') return null
  if (v.exit !== null && typeof v.exit !== 'number') return null
  const results = v.results === null ? null : readResults(v.results)
  if (v.results !== null && results === null) return null
  if (v.error !== undefined && v.error !== 'no_results' && v.error !== 'bad_results') return null
  return { at: v.at, ms: v.ms, exit: v.exit as number | null, timedOut: v.timedOut, results, tail: v.tail.slice(-4000), ...(v.error ? { error: v.error as 'no_results' | 'bad_results' } : {}) }
}

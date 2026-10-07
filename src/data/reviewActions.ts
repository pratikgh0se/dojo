import { buildJobRequest, type AiErrorCode } from '../ai/types'
import { newId } from '../lib/id'
import { planPosition, TOTAL_SPRINTS } from '../rules/sprint'
import { buildReviewStats } from '../rules/review'
import { callJob } from './aiActions'
import { getSettings, type DojoDB } from './db'
import type { ReviewKind, ReviewRow } from './types'

export type ReviewResult = { ok: true; review: ReviewRow } | { ok: false; code: AiErrorCode | 'no_start'; error: string }

/** "Build review": numbers from events and sessions in code, prose from the `review_sprint` job. Stored on success only. */
export async function buildReview(d: DojoDB, sprint: number, at: number, auto = false): Promise<ReviewResult> {
  const startDate = (await getSettings(d)).startDate
  if (!startDate) return { ok: false, code: 'no_start', error: 'Set a start date first' }
  const [tickets, sessions, events] = await Promise.all([d.tickets.toArray(), d.sessions.toArray(), d.events.toArray()])
  const stats = buildReviewStats({ sprint, startDate, nowMs: at, tickets, sessions, events })
  const res = await callJob(d, 'review_sprint', buildJobRequest('review_sprint', null, { stats }), at)
  const kind: ReviewKind = auto ? 'auto' : 'manual'
  if (!res.ok && !auto) return { ok: false, code: res.code, error: res.error }
  // an automatic review keeps its numbers even when the prose could not be written; "Build review" writes another
  const review: ReviewRow = {
    id: newId('rv', at), sprint, at, stats, kind, provider: res.provider, prose: res.ok ? res.output.prose.trim() : '',
    ...(res.ok && res.output.doBetter?.length ? { doBetter: res.output.doBetter.map(s => s.trim()).filter(Boolean) } : {}),
  }
  // The check and the add are one transaction: two tabs (or two runs) that both got prose add only one auto review.
  const kept = await d.transaction('rw', d.reviews, async () => {
    if (auto) {
      const have = (await d.reviews.where('sprint').equals(sprint).toArray()).find(r => r.kind === 'auto')
      if (have) return have
    }
    await d.reviews.add(review)
    return review
  })
  return { ok: true, review: kept }
}

/** Auto-reviews built per app open (per session) at most, so a long absence cannot start a burst of AI calls. */
export const AUTO_REVIEWS_PER_OPEN = 3

/**
 * The ended sprints (from where tracking began) with no AUTOMATIC review yet, NEWEST first, skipping `exclude`
 * (sprints already attempted) before the cut to `limit`. A manual review, even one built mid-sprint, does not
 * stand in for the end-of-sprint one.
 */
export async function sprintsNeedingReview(
  d: DojoDB, nowMs: number, exclude: ReadonlySet<number> = new Set(), limit = AUTO_REVIEWS_PER_OPEN,
): Promise<number[]> {
  const s = await getSettings(d)
  if (!s.startDate || s.trackedFrom === undefined) return []
  const pos = planPosition(nowMs, s.startDate)
  const ended = pos.phase === 'active' ? pos.sprint - 1 : pos.phase === 'after' ? TOTAL_SPRINTS : 0
  const have = new Set((await d.reviews.toArray()).filter(r => r.kind === 'auto').map(r => r.sprint))
  const out: number[] = []
  for (let n = ended; n >= Math.max(1, s.trackedFrom) && out.length < limit; n--) if (!have.has(n) && !exclude.has(n)) out.push(n)
  return out
}

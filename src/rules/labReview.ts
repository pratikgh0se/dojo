// The AI review of a lab, judged by the app (R2 W2): validate the reply against the rubric, drop quotes that are not in the work,
// cap what a score cannot be backed up, and compute the percent. The model's own percent or verdict is never read. Pure.
import type { LabReviewBundle, LabReviewCheck } from '../ai/types'
import type { LabEvidence, LabReviewItem, LabResults, Redo } from '../data/types'
import { addLocalDays, localDayKey } from '../lib/dates'

/** 70 percent or more is Proven. */
export const PASS_PERCENT = 70
/** The plain line for a reply that stayed unusable after the helper's one retry. There is no self-score fallback: Retry asks again. */
export const LAB_REVIEW_INVALID = 'The review did not come through in a form Dojo can read. Nothing is lost: Retry asks again.'

/** The text a quote may come from: WRITEUP.md and the diffs of the files that were sent. */
export function bundleText(bundle: Pick<LabReviewBundle, 'writeup' | 'files'>): string {
  return [bundle.writeup, ...bundle.files.map(f => ('diff' in f ? f.diff : ''))].join('\n')
}

/** floor(sum of scores * 100 / (3 * number of items)); 0 for no items. */
export function percent(items: readonly { score: number }[]): number {
  if (items.length === 0) return 0
  return Math.floor((items.reduce((n, i) => n + i.score, 0) * 100) / (3 * items.length))
}
export const passedAt = (pct: number): boolean => pct >= PASS_PERCENT

/** The items scored 0 or 1: "To work on", and the ones that become Review cards. */
export const weakItems = <T extends { score: number }>(items: readonly T[]): T[] => items.filter(i => i.score <= 1)

/** A quote longer than this is dropped (LAB-71); the prompt asks for 300. */
const QUOTE_MAX = 400
/** An item keeps at most this many entries: the first that survive the drop rules. */
const EVIDENCE_MAX = 3

export type ReviewCheck = { ok: true; items: LabReviewItem[]; summary: string } | { ok: false; error: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The reply of the `lab_review` job against the lab's rubric.
 * - Invalid (the caller shows LAB_REVIEW_INVALID and Retry): not an object, a missing, extra or repeated rubric id, a score that is not an integer 0 to 3, no `stronger`.
 * - Every `quote` must appear verbatim in the work sent (`bundleText`), be at most 400 characters and come with a `file` and a `line`.
 *   Entries that do not are dropped (LAB-42, LAB-71), then the first 3 are kept; an item scored 2 or 3 left with no quote is capped at 1.
 * Items come back in rubric order. The reply's own `percent` and `passed`, if any, are ignored.
 */
export function checkReview(reply: unknown, bundle: Pick<LabReviewBundle, 'writeup' | 'files'>, rubric: readonly { id: string }[]): ReviewCheck {
  const bad = (error: string): ReviewCheck => ({ ok: false, error })
  if (!isObj(reply) || !Array.isArray(reply.items)) return bad('the reply has no items')
  const byId = new Map<string, Record<string, unknown>>()
  for (const it of reply.items) {
    if (!isObj(it) || typeof it.id !== 'string') return bad('an item has no id')
    if (byId.has(it.id)) return bad(`item ${it.id} appears twice`)
    byId.set(it.id, it)
  }
  const want = new Set(rubric.map(r => r.id))
  for (const id of byId.keys()) if (!want.has(id)) return bad(`item ${id} is not in the rubric`)
  const text = bundleText(bundle)
  const items: LabReviewItem[] = []
  for (const { id } of rubric) {
    const it = byId.get(id)
    if (!it) return bad(`item ${id} is missing`)
    if (typeof it.score !== 'number' || !Number.isInteger(it.score) || it.score < 0 || it.score > 3) return bad(`item ${id}: score must be an integer from 0 to 3`)
    if (typeof it.stronger !== 'string' || it.stronger.trim() === '') return bad(`item ${id}: no "stronger" text`)
    const evidence: LabEvidence[] = (Array.isArray(it.evidence) ? it.evidence : []).flatMap((e): LabEvidence[] =>
      isObj(e) && typeof e.quote === 'string' && e.quote.trim() !== '' && e.quote.length <= QUOTE_MAX && text.includes(e.quote)
        && typeof e.file === 'string' && e.file !== '' && typeof e.line === 'number' && Number.isInteger(e.line)
        ? [{ quote: e.quote, file: e.file, line: e.line }]
        : []).slice(0, EVIDENCE_MAX)
    const score = (it.score >= 2 && evidence.length === 0 ? 1 : it.score) as LabReviewItem['score']
    items.push({ id, score, evidence, stronger: it.stronger.trim() })
  }
  return { ok: true, items, summary: typeof reply.summary === 'string' ? reply.summary.trim() : '' }
}

/** What the job is told of the latest run: the checks, with names and details clipped, at most 4000 bytes as JSON (the helper's body cap is 64 KiB). */
export const RESULTS_JSON_MAX = 4000
export function reviewResults(results: LabResults | null | undefined): LabReviewCheck[] | null {
  if (!results) return null
  const out: LabReviewCheck[] = []
  for (const c of results.checks) {
    const next = [...out, { id: c.id, name: c.name.slice(0, 80), status: c.status, detail: c.detail.slice(0, 160) }]
    if (JSON.stringify(next).length > RESULTS_JSON_MAX) break
    out.push(next[next.length - 1])
  }
  return out
}

export const reviewRedoId = (labId: string, rubricId: string): string => `lr-${labId}-${rubricId}`

/**
 * The Review cards a review writes: one `lab_review` redo per item scored 0 or 1, on the lab's closing ticket, stage 0, due the next
 * local day, `piece` = { topic: the lab's title, question: the rubric text, answer: the item's "stronger" text }. An id that already
 * has an OPEN card gets nothing (a repeated review never duplicates or rewrites a card); a closed one is opened again.
 */
export function reviewRedos(a: {
  labId: string; labTitle: string; closingTicket: string; items: readonly LabReviewItem[]; rubric: readonly { id: string; text: string }[]
  existing: readonly Redo[]; nowMs: number
}): Redo[] {
  const open = new Set(a.existing.filter(r => r.closedAt === undefined).map(r => r.id))
  const text = new Map(a.rubric.map(r => [r.id, r.text]))
  return weakItems(a.items).flatMap((it): Redo[] => {
    const id = reviewRedoId(a.labId, it.id)
    if (open.has(id)) return []
    return [{
      id, ticketId: a.closingTicket, source: 'lab_review', createdAt: a.nowMs, stage: 0, due: localDayKey(addLocalDays(a.nowMs, 1)),
      passed: [], helpCost: 0, refunded: 0, piece: { topic: a.labTitle, question: text.get(it.id) ?? it.id, answer: it.stronger },
    }]
  })
}

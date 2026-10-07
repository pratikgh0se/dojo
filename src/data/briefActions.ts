import type { AiErrorCode } from '../ai/types'
import { buildJobRequest, type BriefOutput } from '../ai/types'
import { aiTicketOf } from '../rules/rungContent'
import { isDraftable, isLearning, isTeachback, briefContext, enforceForge, forgeCodeProblem, sprintDraftQueue, toBrief } from '../rules/brief'
import { callJob } from './aiActions'
import type { DojoDB } from './db'
import type { Brief, Ticket } from './types'

export type DraftResult =
  | { ok: true; drafted: boolean }
  | { ok: false; code: AiErrorCode; error: string }

/** Drafts one card's brief through the `brief` job. A failure saves nothing for that card (BR-14). */
export async function draftBrief(d: DojoDB, ticketId: string, at: number): Promise<DraftResult> {
  const t = await d.tickets.get(ticketId)
  if (!t || t.archived) return { ok: false, code: 'bad_request', error: 'Ticket not found' }
  if (t.brief || !isDraftable(t)) return { ok: true, drafted: false } // a split card or a part is never drafted (ruling 25 R3)
  const res = await callJob(d, 'brief', buildJobRequest('brief', aiTicketOf(t), briefContext(t)), at)
  if (!res.ok) return { ok: false, code: res.code, error: res.error }
  if (isLearning(t) && (res.output.deliverable.kind !== 'answers' || res.output.questions.length === 0)) {
    return { ok: false, code: 'invalid_output', error: 'invalid brief output: a watch or read card needs an answers deliverable with questions' }
  }
  const forge = briefContext(t).forge
  const problem = forge ? forgeCodeProblem(res.output) : null
  if (problem) return { ok: false, code: 'invalid_output', error: `invalid brief output: ${problem}` }
  const brief = toBrief(enforceForge(res.output, forge, isTeachback(t)))
  return d.transaction('rw', d.tickets, async (): Promise<DraftResult> => {
    const fresh = await d.tickets.get(ticketId)
    if (!fresh || fresh.archived) return { ok: false, code: 'bad_request', error: 'Ticket not found' }
    if (fresh.brief || !isDraftable(fresh)) return { ok: true, drafted: false } // split while the draft was written
    await d.tickets.put({ ...fresh, brief })
    return { ok: true, drafted: true }
  })
}

export interface DraftProgress { done: number; total: number; failed: number; title?: string }
/** UAT r3 P2: failures that hit every card alike (no CLI, no login, no helper). The run stops at the first one
 * and counts the cards it did not try as failed, instead of spawning a doomed call per card. */
export const DRAFT_STOP_CODES: ReadonlySet<AiErrorCode> = new Set<AiErrorCode>(['claude_missing', 'claude_signed_out', 'helper_unreachable'])
export interface DraftSummary { total: number; drafted: number; failed: number; firstError?: { code: AiErrorCode; error: string } }

/**
 * "Draft briefs for Sprint N": every unfinished card of the sprint without a brief, one at a time.
 * A failed card keeps going with the next; the cards that already have a brief are skipped, so an
 * interrupted run resumes by simply running it again.
 */
export async function draftSprint(
  d: DojoDB, sprint: number, opts: { now: () => number; onProgress?: (p: DraftProgress) => void; signal?: AbortSignal },
): Promise<DraftSummary> {
  const queue = sprintDraftQueue(await d.tickets.toArray(), sprint)
  const sum: DraftSummary = { total: queue.length, drafted: 0, failed: 0 }
  let done = 0
  opts.onProgress?.({ done, total: queue.length, failed: 0 })
  for (const t of queue) {
    if (opts.signal?.aborted) break
    opts.onProgress?.({ done, total: queue.length, failed: sum.failed, title: t.title })
    const r = await draftBrief(d, t.id, opts.now())
    done++
    if (!r.ok) {
      sum.failed++
      sum.firstError ??= { code: r.code, error: r.error }
      if (DRAFT_STOP_CODES.has(r.code)) {
        sum.failed += queue.length - done
        done = queue.length
      }
    } else if (r.drafted) sum.drafted++
    opts.onProgress?.({ done, total: queue.length, failed: sum.failed })
    if (done === queue.length) break
  }
  return sum
}

export type BriefEdit = Pick<Brief, 'goal' | 'steps' | 'minutes' | 'dayType' | 'learn' | 'outcome' | 'deliverable' | 'questions'>

/** Only http(s) links are kept: a javascript: or data: href on the card would run script. */
export const isWebUrl = (u: string): boolean => /^https?:\/\/\S+$/i.test(u)

/** Cleans what the editor hands over: trimmed text, no empty steps or lines, minutes 5-480. */
export function cleanEdit(e: BriefEdit): BriefEdit {
  const t = (s: string) => s.trim()
  return {
    goal: t(e.goal),
    steps: e.steps.map(s => ({ text: t(s.text), ...(s.url && isWebUrl(t(s.url)) ? { url: t(s.url) } : {}) })).filter(s => s.text),
    minutes: Math.max(5, Math.min(480, Math.round(Number.isFinite(e.minutes) ? e.minutes : 5))),
    dayType: e.dayType,
    learn: e.learn.map(t).filter(Boolean),
    outcome: t(e.outcome),
    deliverable: { kind: e.deliverable.kind, prompt: t(e.deliverable.prompt) },
    questions: e.questions.map(q => ({ ...q, q: t(q.q) })),
  }
}

type Update = { ok: true } | { ok: false; message: string }

async function patchBrief(d: DojoDB, id: string, fn: (t: Ticket & { brief: Brief }) => Brief): Promise<Update> {
  return d.transaction('rw', d.tickets, async (): Promise<Update> => {
    const t = await d.tickets.get(id)
    if (!t?.brief) return { ok: false, message: 'This card has no brief yet' }
    await d.tickets.put({ ...t, brief: fn(t as Ticket & { brief: Brief }) })
    return { ok: true }
  })
}

/** Saving an edit makes it the user's brief: source "edited", and back to draft until approved again. */
export async function saveBrief(d: DojoDB, id: string, edit: BriefEdit): Promise<Update> {
  const clean = cleanEdit(edit)
  // the rules the editor shows are enforced here too: no empty question, and a learning card keeps at least one
  if (clean.questions.some(q => !q.q.trim())) return { ok: false, message: 'Every question needs its text' }
  const t0 = await d.tickets.get(id)
  if (t0 && isLearning(t0) && clean.questions.length === 0) return { ok: false, message: 'A learning card needs at least one question' }
  return patchBrief(d, id, t => {
    const urls = new Set(clean.steps.flatMap(s => (s.url ? [s.url] : [])))
    const linkCheck = t.brief.linkCheck?.filter(l => urls.has(l.url))
    const { linkCheck: _drop, ...rest } = t.brief
    return { ...rest, ...clean, status: 'draft', source: 'edited', ...(linkCheck?.length ? { linkCheck } : {}) }
  })
}

export function approveBrief(d: DojoDB, id: string): Promise<Update> {
  return patchBrief(d, id, t => ({ ...t.brief, status: 'approved' }))
}

export function saveLinkCheck(d: DojoDB, id: string, results: NonNullable<Brief['linkCheck']>): Promise<Update> {
  return patchBrief(d, id, t => ({ ...t.brief, linkCheck: results }))
}

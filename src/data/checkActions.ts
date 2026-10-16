import { buildJobRequest, type AiErrorCode, type BriefQuestion, type CheckResult } from '../ai/types'
import { newId } from '../lib/id'
import { checkInputs, checkRedoDue, explainQuestions, normalizeResults, passRule, unanswered, type CheckAnswer } from '../rules/check'
import { aiTicketOf } from '../rules/rungContent'
import { callJob } from './aiActions'
import { moveTicket } from './boardActions'
import { createExplainRedos } from './explainActions'
import type { DojoDB } from './db'
import type { CheckAttemptRow, Redo, Ticket } from './types'

export type CheckSubmit =
  | { ok: true; passed: boolean; results: CheckResult[]; attempt: CheckAttemptRow; xpDelta: number }
  | { ok: false; code: AiErrorCode | 'incomplete' | 'no_brief' | 'skipped'; error: string }

/**
 * "Mark done" on a learning card: grade the answers, keep the attempt. A pass finishes the card through
 * moveTicket (XP via netOf) and closes a redo an earlier failure scheduled; a fail leaves the card open,
 * and schedules (or pushes back) one redo 3 local days out.
 */
export async function submitCheck(
  d: DojoDB, ticketId: string, answers: CheckAnswer[], at: number, opts: { finish?: boolean; questions?: BriefQuestion[] } = {},
): Promise<CheckSubmit> {
  const finish = opts.finish ?? true
  const t = await d.tickets.get(ticketId)
  const questions = opts.questions ?? t?.brief?.questions ?? []
  if (!t || questions.length === 0) return { ok: false, code: 'no_brief', error: 'This card has no questions' }
  if (unanswered(questions, answers).length > 0) return { ok: false, code: 'incomplete', error: 'Answer every question first' }
  const res = await callJob(d, 'check', buildJobRequest('check', aiTicketOf(t), { questions: checkInputs(questions, answers) }), at)
  if (!res.ok) return { ok: false, code: res.code, error: res.error }
  const results = normalizeResults(questions, answers, res.output.results)
  const passed = passRule(results)
  const attempt: CheckAttemptRow = {
    id: newId('ca', at), ticketId, at, passed, feedback: results,
    answers: answers.map(a => ({ id: a.id, ...(a.answer !== undefined ? { answer: a.answer } : {}), ...(a.choice !== undefined ? { choice: a.choice } : {}) })),
  }
  let xpDelta = 0
  await d.transaction('rw', [d.checkAttempts, d.redos, d.events, d.tickets, d.rungUses], async () => {
    await d.checkAttempts.add(attempt)
    await d.events.add({ t: 'check', id: ticketId, at, passed })
    // an explain or lab-review card is never "the failed-check redo": a re-run check must not close or push it back
    const live = (await d.redos.where('ticketId').equals(ticketId).toArray()).find(r => r.closedAt === undefined && r.source !== 'explain' && r.source !== 'lab_review')
    if (passed) {
      if (live) await d.redos.put({ ...live, passed: [...live.passed, true], closedAt: at })
    } else if (live) {
      await d.redos.put({ ...live, passed: [...live.passed, false], due: checkRedoDue(at) })
    } else {
      const redo: Redo = {
        id: newId('r', at), ticketId, source: 'check_failed', createdAt: at, stage: 0, due: checkRedoDue(at),
        passed: [], helpCost: 0, refunded: 0,
      }
      await d.redos.add(redo)
    }
    // the attempt, the redo and the finished card land together or not at all
    if (passed && finish && t.status !== 'done') {
      const r = await moveTicket(d, ticketId, 'done', at)
      if (r.ok) xpDelta = r.xpDelta
    }
  })
  return { ok: true, passed, results, attempt, xpDelta }
}

/**
 * A finished ticket's explain answers go to the same `check` job. Nothing is finished or reopened here: the attempt is
 * stored and a failure schedules the usual three-day redo. Skipped (no AI call) unless every explain question has an
 * answer and the ticket carries a reference answer for each question. Questions come from `explain` only, never a legacy
 * brief, because the learner's answers are indexed by `explain`. A pass also schedules the explain Review cards (W5, RIT-01); `topic` is the
 * title of the ticket's plan node.
 */
export async function submitExplainCheck(d: DojoDB, ticketId: string, texts: string[], at: number, topic?: string): Promise<CheckSubmit> {
  const t = await d.tickets.get(ticketId)
  const qs = t ? explainQuestions(t) : []
  // a reference answer for every question, or there is nothing to grade against
  if (!t || qs.length === 0 || (t.explainAnswers?.length ?? 0) < qs.length) return { ok: false, code: 'skipped', error: 'No reference answers to check against' }
  if (texts.length < qs.length || texts.slice(0, qs.length).some(x => !x.trim())) return { ok: false, code: 'skipped', error: 'Answer every question to have them checked' }
  const r = await submitCheck(d, ticketId, qs.map((q, i) => ({ id: q.id, answer: texts[i] })), at, { finish: false, questions: qs })
  if (r.ok && r.passed) await createExplainRedos(d, t, topic ?? t.title, at)
  return r
}

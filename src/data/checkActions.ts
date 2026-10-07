import { buildJobRequest, type AiErrorCode, type CheckResult } from '../ai/types'
import { newId } from '../lib/id'
import { checkInputs, checkRedoDue, normalizeResults, passRule, unanswered, type CheckAnswer } from '../rules/check'
import { CAPSTONE_STAGES } from '../content/capstoneStages'
import { deliverableOf } from '../rules/brief'
import { aiTicketOf } from '../rules/rungContent'
import { callJob } from './aiActions'
import { moveTicket } from './boardActions'
import type { DojoDB } from './db'
import type { CheckAttemptRow, Deliverable, Redo, Ticket } from './types'
import { containerState } from '../rules/split'

export type CheckSubmit =
  | { ok: true; passed: boolean; results: CheckResult[]; attempt: CheckAttemptRow; xpDelta: number }
  | { ok: false; code: AiErrorCode | 'incomplete' | 'no_brief'; error: string }

/**
 * "Mark done" on a learning card: grade the answers, keep the attempt. A pass finishes the card through
 * moveTicket (XP via netOf) and closes a redo an earlier failure scheduled; a fail leaves the card open,
 * and schedules (or pushes back) one redo 3 local days out.
 */
export async function submitCheck(d: DojoDB, ticketId: string, answers: CheckAnswer[], at: number): Promise<CheckSubmit> {
  const t = await d.tickets.get(ticketId)
  const questions = t?.brief?.questions ?? []
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
    const live = (await d.redos.where('ticketId').equals(ticketId).toArray()).find(r => r.closedAt === undefined)
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
    if (passed && t.status !== 'done') {
      if (t.children?.length) {
        // ruling 10 Q22: a split card's check stays on it; it finishes once every session is done too (no XP of its own)
        const marked = { ...t, checkPassedAt: at }
        const kids = (await d.tickets.bulkGet(t.children)).filter((c): c is Ticket => c !== undefined)
        await d.tickets.put(containerState(marked, kids, at) ?? marked)
      } else {
        const r = await moveTicket(d, ticketId, 'done', at, true)
        if (r.ok) xpDelta = r.xpDelta
      }
    }
  })
  return { ok: true, passed, results, attempt, xpDelta }
}

class Refused extends Error {}

export type DeliverableSubmit = { ok: true; deliverable: Deliverable; xpDelta: number } | { ok: false; error: string }

/** "Mark done" on a build card: keep what was handed in (text, code as text, a link or a path), then finish the card. */
export async function submitDeliverable(d: DojoDB, ticketId: string, text: string, at: number, feedback?: string[]): Promise<DeliverableSubmit> {
  const t = await d.tickets.get(ticketId)
  if (!t?.brief) return { ok: false, error: 'This card has no brief yet' }
  const body = text.trim()
  if (!body) return { ok: false, error: 'Hand something in first' }
  const deliverable: Deliverable = { kind: (deliverableOf(t) ?? t.brief.deliverable).kind, text: body, at, ...(feedback?.length ? { feedback } : {}) }
  let xpDelta = 0
  let refused: string | null = null
  await d.transaction('rw', [d.tickets, d.events, d.rungUses], async () => {
    const fresh = await d.tickets.get(ticketId)
    if (!fresh) return
    await d.tickets.put({ ...fresh, deliverable })
    if (fresh.status !== 'done') {
      const r = await moveTicket(d, ticketId, 'done', at)
      if (r.ok) xpDelta = r.xpDelta
      else { refused = r.message; throw new Refused() }
    }
  }).catch(e => { if (!(e instanceof Refused)) throw e })
  if (refused) return { ok: false, error: refused }
  return { ok: true, deliverable, xpDelta }
}

export type FeedbackResult = { ok: true; feedback: string[] } | { ok: false; code: AiErrorCode; error: string }

/**
 * Optional "Get feedback": the grade job on the deliverable text. Feedback only: it never writes code and never finishes
 * the card. A teach-back (an explanation deliverable) is graded as prose against the stage rubric (UAT cu-5 P2-2), with
 * no repo, commit or diff to look for; anything else is graded as a piece of work.
 */
export async function deliverableFeedback(d: DojoDB, ticketId: string, text: string, at: number): Promise<FeedbackResult> {
  const t = await d.tickets.get(ticketId)
  if (!t) return { ok: false, code: 'bad_request', error: 'Ticket not found' }
  const explanation = deliverableOf(t)?.kind === 'explanation'
  const res = await callJob(d, 'grade', buildJobRequest('grade', aiTicketOf(t), explanation
    ? {
      proofNote: text.trim(),
      rubric: `${t.brief?.outcome ?? ''} Feedback only: never write the explanation or any code for the learner.`.trim(),
      deliverableKind: 'explanation',
      ...(t.stage !== undefined ? { stage: t.stage, stageTitle: CAPSTONE_STAGES[t.stage]?.title } : {}),
    }
    : {
      proofNote: text.trim(),
      rubric: `${t.brief?.outcome ?? ''} Feedback only: never write code for the learner.`.trim(),
    }), at)
  if (!res.ok) return { ok: false, code: res.code, error: res.error }
  return { ok: true, feedback: [...res.output.feedback, ...res.output.missing.map(m => `Missing: ${m}`)] }
}

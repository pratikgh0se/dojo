// Learning checks (briefs spec §2). Pure.
import type { BriefQuestion, CheckQuestionInput, CheckResult } from '../ai/types'
import { addLocalDays, localDayKey } from '../lib/dates'

export interface CheckAnswer { id: string; answer?: string; choice?: number }

/** Pass rule (spec §2): every question passes, or at most one is partial and none fail. */
export function passRule(results: readonly Pick<CheckResult, 'verdict'>[]): boolean {
  if (results.length === 0) return false
  const fails = results.filter(r => r.verdict === 'fail').length
  const partial = results.filter(r => r.verdict === 'partial').length
  return fails === 0 && partial <= 1
}

/** A question is answered when an open one has text and an mcq has a choice. */
export function isAnswered(q: BriefQuestion, a: CheckAnswer | undefined): boolean {
  if (!a) return false
  return q.kind === 'mcq' ? a.choice !== undefined : (a.answer ?? '').trim().length > 0
}

export function unanswered(questions: readonly BriefQuestion[], answers: readonly CheckAnswer[]): BriefQuestion[] {
  return questions.filter(q => !isAnswered(q, answers.find(a => a.id === q.id)))
}

/** What the `check` job is sent: the questions with the learner's answers merged in. */
export function checkInputs(questions: readonly BriefQuestion[], answers: readonly CheckAnswer[]): CheckQuestionInput[] {
  return questions.map(q => {
    const a = answers.find(x => x.id === q.id)
    return {
      id: q.id, kind: q.kind, q: q.q,
      ...(q.choices ? { choices: q.choices } : {}),
      ...(q.keyIdeas ? { keyIdeas: q.keyIdeas } : {}),
      ...(q.correct !== undefined ? { correct: q.correct } : {}),
      ...(a?.answer !== undefined ? { answer: a.answer } : {}),
      ...(a?.choice !== undefined ? { choice: a.choice } : {}),
    }
  })
}

/**
 * One result per question, in question order. An MCQ is graded here, never trusted to the model;
 * a question the model left out counts as a fail.
 */
export function normalizeResults(
  questions: readonly BriefQuestion[], answers: readonly CheckAnswer[], results: readonly CheckResult[],
): CheckResult[] {
  return questions.map(q => {
    if (q.kind === 'mcq') {
      const chosen = answers.find(a => a.id === q.id)?.choice
      const ok = chosen !== undefined && chosen === q.correct
      const right = q.choices?.[q.correct ?? -1]
      const said = results.find(r => r.id === q.id)
      return ok
        ? { id: q.id, verdict: 'pass', correction: '', pointer: '' }
        : { id: q.id, verdict: 'fail', correction: said?.verdict === 'fail' && said.correction ? said.correction : right ? `The answer is "${right}"` : 'Choose again', pointer: said?.pointer || 'Step 1' }
    }
    return results.find(r => r.id === q.id) ?? { id: q.id, verdict: 'fail', correction: 'No feedback came back for this question', pointer: '' }
  })
}

export const CHECK_REDO_DAYS = 3

/** The redo a failed check schedules: a local date, `YYYY-MM-DD` (Addendum 1 Q6). */
export function checkRedoDue(nowMs: number): string {
  return localDayKey(addLocalDays(nowMs, CHECK_REDO_DAYS))
}

/** "1 of 2 right": how the card lists an attempt without repeating the dialog's verdict words. */
export function attemptScore(results: readonly Pick<CheckResult, 'verdict'>[]): string {
  return `${results.filter(r => r.verdict === 'pass').length} of ${results.length} right`
}

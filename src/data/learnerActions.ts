import type { DojoDB } from './db'
import type { Ticket } from './types'

export type LearnerResult = { ok: true } | { ok: false; message: string }
export const LEARNER_NOTES_MAX = 20_000
export const EXPLAIN_RESPONSE_MAX = 4_000
const MARKS: ReadonlySet<string> = new Set(['done', 'partial', 'skipped'])
const fail = (message: string): LearnerResult => ({ ok: false, message })

/** One read-modify-write of a live ticket in its own transaction; `edit` returns the next row or a refusal. */
async function editTicket(d: DojoDB, id: string, edit: (t: Ticket) => Ticket | string): Promise<LearnerResult> {
  return d.transaction('rw', d.tickets, async (): Promise<LearnerResult> => {
    const t = await d.tickets.get(id)
    if (!t || t.archived) return fail('Ticket not found')
    const next = edit(t)
    if (typeof next === 'string') return fail(next)
    await d.tickets.put(next)
    return { ok: true }
  })
}

/** The learner's notes on a ticket; an empty text removes them. */
export function setLearnerNotes(d: DojoDB, id: string, text: string, now: number): Promise<LearnerResult> {
  if (text.length > LEARNER_NOTES_MAX) return Promise.resolve(fail(`Notes can be at most ${LEARNER_NOTES_MAX} characters`))
  return editTicket(d, id, t => {
    const { learnerNotes: _n, ...rest } = t
    return { ...rest, ...(text === '' ? {} : { learnerNotes: text }), learnerUpdatedAt: now }
  })
}

/** The learner's answer to question `index` of `explain`; unanswered questions before it hold ''. */
export function setExplainResponse(d: DojoDB, id: string, index: number, text: string, now: number): Promise<LearnerResult> {
  if (text.length > EXPLAIN_RESPONSE_MAX) return Promise.resolve(fail(`An answer can be at most ${EXPLAIN_RESPONSE_MAX} characters`))
  return editTicket(d, id, t => {
    const n = t.explain?.length ?? 0
    if (n === 0) return 'This ticket has no questions'
    if (!Number.isInteger(index) || index < 0 || index >= n) return `Question ${index + 1} does not exist`
    const answers = Array.from({ length: n }, (_, i) => t.explainResponses?.[i] ?? '')
    answers[index] = text
    return { ...t, explainResponses: answers, learnerUpdatedAt: now }
  })
}

/** The learner's own verdict on a build (before automatic checks); null clears it. */
export function setSelfMark(d: DojoDB, id: string, mark: 'done' | 'partial' | 'skipped' | null, now: number): Promise<LearnerResult> {
  if (mark !== null && !MARKS.has(mark)) return Promise.resolve(fail('Pick done, partial or skipped'))
  return editTicket(d, id, t => {
    const { selfMark: _m, ...rest } = t
    return { ...rest, ...(mark === null ? {} : { selfMark: mark }), learnerUpdatedAt: now }
  })
}

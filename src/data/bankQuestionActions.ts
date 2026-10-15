// R1 W6: the writes of the Design and AI question banks (trees-and-banks.md BANK-11 to BANK-14, BANK-19, BANK-24).
// Only a grade, Add to Review, More questions or Delete writes; opening, filtering, typing and revealing never do (BANK-25).
import { buildJobRequest, AI_ERRORS } from '../ai/types'
import { bankRedoFor, extraRowsFrom, gradeRow, openBankRedo, type NodeRef, type Question } from '../rules/bankQuestions'
import { callJob } from './aiActions'
import type { DojoDB } from './db'
import type { BankArea, BankExtraRow, BankGrade } from './types'

/** BANK-11, BANK-12: the one grade row of a question. A first grade is `tries` 1; a regrade keeps the id and adds one try. Nothing else is written. */
export async function gradeQuestion(d: DojoDB, q: Question, grade: BankGrade, at: number): Promise<void> {
  await d.transaction('rw', d.bankGrades, async () => {
    await d.bankGrades.put(gradeRow(await d.bankGrades.get(q.id), q, grade, at))
  })
}

export type AddReviewResult = { ok: true; added: boolean }

/** BANK-14: one `bank_q` redo, due three local days out; never a second open one for the same question. */
export async function addQuestionToReview(d: DojoDB, q: Question, topic: string, at: number): Promise<AddReviewResult> {
  return d.transaction('rw', d.redos, async (): Promise<AddReviewResult> => {
    const open = openBankRedo(await d.redos.where('ticketId').equals(q.id).toArray(), q.id)
    if (open) return { ok: true, added: false }
    await d.redos.add(bankRedoFor(q, topic, at))
    return { ok: true, added: true }
  })
}

export type MoreResult = { ok: true; rows: BankExtraRow[] } | { ok: false; message: string }

export interface MoreInput {
  area: BankArea
  node: NodeRef & { oneLiner?: string }
  /** the questions of that node as listed (so the job avoids them) */
  existing: readonly string[]
  /** every question id in the plan and in `bankExtra`, so the new ids are unique across both */
  taken: ReadonlySet<string>
}

/**
 * BANK-19, BANK-21, BANK-22: ask the AI for five more questions on one node, then write them as five `bankExtra` rows, all in one
 * transaction. `callJob` logs the job (`bank_more`) either way. On a failure nothing but the log row is written.
 */
export async function makeMoreQuestions(d: DojoDB, input: MoreInput, at: number): Promise<MoreResult> {
  const request = buildJobRequest('bank_more', null, {
    area: input.area, node: input.node.id, nodeTitle: input.node.title, nodeAbout: input.node.oneLiner ?? '', avoid: [...input.existing], count: 5,
  })
  const r = await callJob(d, 'bank_more', request, at)
  if (!r.ok) return { ok: false, message: AI_ERRORS[r.code].message }
  // ids may collide with a row a second tab wrote meanwhile: read the table inside the transaction
  return d.transaction('rw', d.bankExtra, async (): Promise<MoreResult> => {
    const taken = new Set(input.taken)
    for (const x of await d.bankExtra.toArray()) taken.add(x.id)
    const rows = extraRowsFrom(r.output.questions, { area: input.area, node: input.node.id }, at, taken)
    await d.bankExtra.bulkAdd(rows)
    return { ok: true, rows }
  })
}

/**
 * BANK-24: delete an AI-made question and its grade row. An open `bank_q` redo on it is left alone (BANK-16); a shipped question
 * (no `bankExtra` row) is never deleted.
 */
export async function deleteExtraQuestion(d: DojoDB, id: string): Promise<boolean> {
  return d.transaction('rw', d.bankExtra, d.bankGrades, async () => {
    if (!(await d.bankExtra.get(id))) return false
    await d.bankExtra.delete(id)
    await d.bankGrades.delete(id)
    return true
  })
}

// R1 W6: the writes of the question banks (BANK-11 to BANK-14, BANK-19, BANK-22, BANK-24).
import { afterEach, describe, expect, it } from 'vitest'
import { addQuestionToReview, deleteExtraQuestion, gradeQuestion, makeMoreQuestions } from '../../src/data/bankQuestionActions'
import type { BankExtraRow, PlanQuestion } from '../../src/data/types'
import { freshDb } from '../helpers/db'

const NOW = new Date(2026, 10, 4, 10, 0, 0).getTime()
const q: PlanQuestion = { id: 'dq1', area: 'design', node: 'SD01', type: 'estimate', difficulty: 2, question: 'How big?', answer: 'About 2 GB.', checklist: ['a'] }
const node = { id: 'SD01', area: 'design', title: 'Estimation', oneLiner: 'Numbers.' }

afterEach(() => { localStorage.clear() })

describe('gradeQuestion (BANK-11, BANK-12)', () => {
  it('writes one row on the first grade and touches no other table', async () => {
    const d = freshDb()
    await gradeQuestion(d, q, 'hard', NOW)
    expect(await d.bankGrades.toArray()).toEqual([{ id: 'dq1', area: 'design', node: 'SD01', grade: 'hard', at: NOW, tries: 1 }])
    expect(await d.redos.count()).toBe(0)
    expect(await d.bankExtra.count()).toBe(0)
    expect(await d.aiLog.count()).toBe(0)
  })
  it('a regrade updates the same row: new grade, later time, one more try', async () => {
    const d = freshDb()
    await gradeQuestion(d, q, 'hard', NOW)
    await gradeQuestion(d, q, 'easy', NOW + 5000)
    expect(await d.bankGrades.toArray()).toEqual([{ id: 'dq1', area: 'design', node: 'SD01', grade: 'easy', at: NOW + 5000, tries: 2 }])
  })
})

describe('addQuestionToReview (BANK-14)', () => {
  it('writes exactly one bank_q redo due three days out', async () => {
    const d = freshDb()
    expect(await addQuestionToReview(d, q, 'Estimation', NOW)).toEqual({ ok: true, added: true })
    const rows = await d.redos.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ source: 'bank_q', ticketId: 'dq1', stage: 0, createdAt: NOW, due: '2026-11-07', piece: { topic: 'Estimation', question: 'How big?', answer: 'About 2 GB.', qid: 'dq1' } })
    expect(rows[0].closedAt).toBeUndefined()
  })
  it('never writes a second open redo for the same question, at any later time', async () => {
    const d = freshDb()
    await addQuestionToReview(d, q, 'Estimation', NOW)
    expect(await addQuestionToReview(d, q, 'Estimation', NOW + 60_000)).toEqual({ ok: true, added: false })
    expect(await d.redos.count()).toBe(1)
  })
  it('a closed redo does not block a new one', async () => {
    const d = freshDb()
    await addQuestionToReview(d, q, 'Estimation', NOW)
    const [r] = await d.redos.toArray()
    await d.redos.put({ ...r, closedAt: NOW + 1 })
    expect(await addQuestionToReview(d, q, 'Estimation', NOW + 2)).toEqual({ ok: true, added: true })
    expect(await d.redos.count()).toBe(2)
  })
})

describe('makeMoreQuestions (BANK-19, BANK-22)', () => {
  it('writes five AI-made rows of the area and node and logs one bank_more job', async () => {
    const d = freshDb()
    const r = await makeMoreQuestions(d, { area: 'design', node, existing: ['Old?'], taken: new Set(['dq1']) }, NOW)
    expect(r.ok).toBe(true)
    const rows = await d.bankExtra.toArray()
    expect(rows).toHaveLength(5)
    for (const x of rows) {
      expect(x).toMatchObject({ area: 'design', node: 'SD01', aiMade: true, at: NOW })
      expect('source' in x).toBe(false)
    }
    expect(new Set(rows.map(x => x.id)).size).toBe(5)
    const log = await d.aiLog.toArray()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ job: 'bank_more', provider: 'fake', ok: true })
  })
  it('on a failed job writes no rows, logs ok false, and says one sentence', async () => {
    const d = freshDb()
    localStorage.setItem('dojo:fake-ai-bank_more', 'error')
    const r = await makeMoreQuestions(d, { area: 'ai', node: { id: 'L1', area: 'llm', title: 'Tokens' }, existing: [], taken: new Set() }, NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/\.$/)
    expect(await d.bankExtra.count()).toBe(0)
    const log = await d.aiLog.toArray()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({ job: 'bank_more', ok: false })
  })
  it('a second run for the same node adds five more with new ids', async () => {
    const d = freshDb()
    await makeMoreQuestions(d, { area: 'design', node, existing: [], taken: new Set() }, NOW)
    await makeMoreQuestions(d, { area: 'design', node, existing: [], taken: new Set() }, NOW)
    const rows = await d.bankExtra.toArray()
    expect(rows).toHaveLength(10)
    expect(new Set(rows.map(x => x.id)).size).toBe(10)
  })
})

describe('deleteExtraQuestion (BANK-24, BANK-16)', () => {
  const extra: BankExtraRow = { ...q, id: 'x-SD01-1', aiMade: true, at: NOW }
  it('removes the row and its grade and leaves an open redo', async () => {
    const d = freshDb()
    await d.bankExtra.add(extra)
    await gradeQuestion(d, extra, 'again', NOW)
    await addQuestionToReview(d, extra, 'Estimation', NOW)
    expect(await deleteExtraQuestion(d, extra.id)).toBe(true)
    expect(await d.bankExtra.count()).toBe(0)
    expect(await d.bankGrades.count()).toBe(0)
    expect(await d.redos.count()).toBe(1)
  })
  it('refuses a shipped question: no bankExtra row means nothing is deleted', async () => {
    const d = freshDb()
    await gradeQuestion(d, q, 'good', NOW)
    expect(await deleteExtraQuestion(d, q.id)).toBe(false)
    expect(await d.bankGrades.count()).toBe(1)
  })
})

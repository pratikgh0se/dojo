// R1 W6: a `bank_q` redo in Review (BANK-15, BANK-16; review.md "Due" and the bank card rule). The flat-invariant tests are in migrate-flat.test.ts.
import { describe, expect, it } from 'vitest'
import type { BankExtraRow, PlanQuestion, Redo } from '../../src/data/types'
import { bankAreaResolver, bankRedoFor } from '../../src/rules/bankQuestions'
import { dueRedos, redoRows } from '../../src/rules/redoQueue'
import { queueMeta, reviewCards } from '../../src/rules/reviewQueue'
import { mkTicket } from '../helpers/tickets'

const NOW = new Date(2026, 10, 4, 10, 0, 0).getTime()
const nodes = [{ id: 'SD01', area: 'design', title: 'Estimation' }, { id: 'L1', area: 'llm', title: 'Tokens' }]
const shipped: PlanQuestion = { id: 'ai-L1-1', area: 'ai', node: 'L1', type: 'concept', difficulty: 1, question: 'What is a token?', answer: 'A piece of text.', checklist: ['x'] }
const made: BankExtraRow = { id: 'x-SD01-9', area: 'design', node: 'SD01', type: 'estimate', difficulty: 2, question: 'How big?', answer: 'About 2 GB.', checklist: ['y'], aiMade: true, at: 1 }
const area = bankAreaResolver([shipped], [made], nodes)
const redoFor = (q: PlanQuestion | BankExtraRow, topic: string, createdAt: number, due: string): Redo => ({ ...bankRedoFor(q, topic, createdAt), due })
const t = mkTicket({ id: 'ai.l1.learn', kind: 'watch', lane: 'path', title: 'Tokens, watched', explain: ['Why?'], explainAnswers: ['Because.'] })
const ticketRedo: Redo = { id: 'r-t', ticketId: t.id, source: 'check_failed', createdAt: NOW - 3 * 86_400_000, stage: 0, due: '2026-11-04', passed: [], helpCost: 0, refunded: 0 }

describe('bank_q cards', () => {
  it('is a check card titled by the topic, kind label Question, lane by the question area', () => {
    const cards = reviewCards({ redos: [redoFor(made, 'Estimation', NOW - 3 * 86_400_000, '2026-11-04'), redoFor(shipped, 'Tokens', NOW - 3 * 86_400_000 + 1, '2026-11-04')], tickets: [], nowMs: NOW, bankArea: area })
    expect(cards.map(c => [c.ticketId, c.kind, c.kindLabel, c.title, c.lane, c.prompt, c.stored])).toEqual([
      ['x-SD01-9', 'check', 'Question', 'Estimation', 'design', 'How big?', 'About 2 GB.'],
      ['ai-L1-1', 'check', 'Question', 'Tokens', 'path', 'What is a token?', 'A piece of text.'],
    ])
  })
  it('counts in the queue next to ticket cards and in the lane split', () => {
    const cards = reviewCards({ redos: [ticketRedo, redoFor(made, 'Estimation', NOW - 1000, '2026-11-04')], tickets: [t], nowMs: NOW, bankArea: area })
    const meta = queueMeta(cards)
    expect(meta.count).toBe(2)
    expect(meta.split).toBe('AI 1 · Design 1')
  })
  it('is due on its date like any redo: not before it, and not once closed', () => {
    const future = redoFor(made, 'Estimation', NOW, '2026-11-07')
    const closed = { ...redoFor(made, 'Estimation', NOW, '2026-11-04'), id: 'c', closedAt: NOW }
    expect(dueRedos([future, closed], [], NOW)).toEqual([])
    expect(dueRedos([future], [], new Date(2026, 10, 7, 9, 0).getTime())).toHaveLength(1)
  })
  it('a redo with no usable piece is not a card', () => {
    const broken: Redo = { ...redoFor(made, 'Estimation', NOW, '2026-11-04'), piece: 'text' }
    expect(dueRedos([broken], [], NOW)).toEqual([])
  })
  it('survives its deleted question: the card keeps the stored question and answer, and the lane follows the topic', () => {
    const gone = bankAreaResolver([], [], nodes)
    const [c] = reviewCards({ redos: [redoFor(made, 'Estimation', NOW - 1000, '2026-11-04')], tickets: [], nowMs: NOW, bankArea: gone })
    expect(c).toMatchObject({ prompt: 'How big?', stored: 'About 2 GB.', lane: 'design', title: 'Estimation' })
    const [c2] = reviewCards({ redos: [redoFor(shipped, 'Tokens', NOW - 1000, '2026-11-04')], tickets: [], nowMs: NOW, bankArea: gone })
    expect(c2.lane).toBe('path')
  })
  it('sorts by due day, then createdAt, then question id, among ticket redos', () => {
    const early = redoFor(made, 'Estimation', NOW - 5 * 86_400_000, '2026-11-02')
    const cards = reviewCards({ redos: [ticketRedo, early], tickets: [t], nowMs: NOW, bankArea: area })
    expect(cards.map(c => c.ticketId)).toEqual(['x-SD01-9', 'ai.l1.learn'])
  })
  it('shows in Today as a row that opens Review', () => {
    const rows = redoRows([redoFor(made, 'Estimation', NOW - 1000, '2026-11-04')], [], [], NOW)
    expect(rows).toEqual([{ ticketId: 'x-SD01-9', title: 'Estimation', text: 'Estimation · How big?', to: '/review' }])
  })
})

import type { JournalPiece, Redo, Ticket } from '../data/types'
import { addLocalDays, localDayKey } from '../lib/dates'
import { REDO_DAYS } from './ladder'

/** `ex-<ticketId>-<index>`: the index is the question's place in `ticket.explain` (0-based), so a second pass can never add a duplicate. */
export const explainRedoId = (ticketId: string, index: number): string => `ex-${ticketId}-${index}`

/**
 * W5: what a passed explain check schedules. One stage-0 `explain` redo per question that has a model answer, due `REDO_DAYS[0]` (3)
 * local days after the pass (a local `YYYY-MM-DD`, like a failed check's redo). `gradeRedo` then moves it to 10 and 30 days.
 * The piece is the `JournalPiece` shape, so the existing check card renders it.
 */
export function explainRedos(t: Pick<Ticket, 'id' | 'explain' | 'explainAnswers'>, topic: string, nowMs: number): Redo[] {
  const due = localDayKey(addLocalDays(nowMs, REDO_DAYS[0]))
  return (t.explain ?? []).flatMap((question, i): Redo[] => {
    const answer = t.explainAnswers?.[i] ?? ''
    if (!question.trim() || !answer.trim()) return []
    const piece: JournalPiece = { topic, question, answer }
    return [{ id: explainRedoId(t.id, i), ticketId: t.id, source: 'explain', createdAt: nowMs, stage: 0, due, passed: [], helpCost: 0, refunded: 0, piece }]
  })
}

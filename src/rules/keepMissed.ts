import type { MissedSpot } from '../ai/types'
import type { DesignSession, JournalPiece, MissedPiece, Redo, RedoSource } from '../data/types'
import { addLocalDays, localDayKey } from '../lib/dates'
import { readDesignMode } from './designMode'
import { learnerWords } from './learnerWords'

/** The redo id for the k-th weak spot (1-based) of a session: fixed, so adding twice is impossible. */
export const keepRedoId = (sessionId: string, k: number): string => `keep-${sessionId}-${k}`

/** The weak spots of an ai-partner session's stored grade (none for With someone, Solo, an old grade or a grade without any). */
export function missedOf(s: Pick<DesignSession, 'mode' | 'interview'>): MissedSpot[] {
  if (readDesignMode(s.mode) !== 'ai-partner') return []
  return s.interview?.final?.missed ?? []
}

export function keepState(s: Pick<DesignSession, 'mode' | 'interview' | 'keptAt'>): { missed: MissedSpot[]; kept: boolean } {
  return { missed: missedOf(s), kept: s.keptAt !== undefined }
}

/** DESIGN-74 amended: Add takes the accent only when no redesign is due; when one is, `session-redesign` keeps it. */
export const keepAccent = (s: Pick<DesignSession, 'redesignDue'>): boolean => s.redesignDue == null

const list = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

export function keepCopy(missed: readonly Pick<MissedSpot, 'topic'>[]): string {
  const n = missed.length
  return `${n} weak ${n === 1 ? 'spot can become a review card' : 'spots can become review cards'}: ${list(missed.map(m => learnerWords(m.topic)))}.`
}
export const keptCopy = (n: number): string => `Added ${n} review ${n === 1 ? 'card' : 'cards'}.`

/** What Add writes: one `design_missed` redo per weak spot on the design ticket, at stage 0, due the next local day. */
export function keepRedos(s: Pick<DesignSession, 'id' | 'designId' | 'mode' | 'interview'>, nowMs: number): Redo[] {
  return missedOf(s).map((m, i): Redo => {
    const piece: MissedPiece = { topic: learnerWords(m.topic), question: learnerWords(m.question), answer: learnerWords(m.answer), sessionId: s.id }
    return {
      id: keepRedoId(s.id, i + 1), ticketId: s.designId, source: 'design_missed', createdAt: nowMs, stage: 0,
      due: localDayKey(addLocalDays(nowMs, 1)), passed: [], helpCost: 0, refunded: 0, piece,
    }
  })
}

/** Redo sources whose `piece` is the card: the question, then the stored answer (a check card whatever the ticket's kind). */
export const isPieceSource = (s: RedoSource): boolean => s === 'design_missed' || s === 'journal_hard' || s === 'lab_review' || s === 'explain'

/** The question and stored answer a redo's piece holds, when it holds them (a legacy redo's `piece` is a plain string). A `design_missed` redo's piece has a session id too; a `journal_hard` redo's does not; a `bank_q` redo's holds a question id (`qid`) and is read by `bankPieceOf`, never here. */
export function missedPieceOf(r: Pick<Redo, 'piece'>): JournalPiece | MissedPiece | null {
  const p = r.piece
  return p && typeof p === 'object' && typeof p.question === 'string' && typeof p.answer === 'string' && !('qid' in p) ? p : null
}

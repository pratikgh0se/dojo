import type { Kind, Redo, RedoStage, Ticket } from '../data/types'
import { addLocalDays } from '../lib/dates'
import { REDO_DAYS, redoDue } from './ladder'
import { bankPieceOf, type BankAreaOf } from './bankQuestions'
import { isPieceSource, missedPieceOf } from './keepMissed'
import { dueRedos, redoAgeDays } from './redoQueue'
import { KIND_LABEL, LANE_LABEL, tagLane } from './ticketMeta'

/** Lanes a card can show under (README "Lane tag": `bank` already reads as `dsa`; `ritual` has no label and reads as AI). */
export type ReviewLane = 'path' | 'dsa' | 'design' | 'career'
/** `check`: write an answer, then compare with the stored one. `replay`: do the ticket again. */
export type CardKind = 'check' | 'replay'
export type Grade = 'missed' | 'close' | 'got'

export interface ReviewCard {
  id: string
  redoId: string
  /** the redo's step (0, 1 or 2): what Got it would schedule next */
  stage: RedoStage
  ticketId: string
  kind: CardKind
  ticketKind: Kind
  /** the ticket title, verbatim (Rulings R2) */
  title: string
  lane: ReviewLane
  /** the local day the redo is due (`YYYY-MM-DD`) */
  dueDay: string
  /** whole local days from the due day to today (`redoAgeDays`); 0 is "due today" */
  ageDays: number
  /** the question (check) or the fixed instruction sentence (replay) */
  prompt: string
  /** the reference answer ('' when the ticket has none, and always '' on a replay card) */
  stored: string
  /** where a replay happens */
  to: string
  /** the kind label when it is not the ticket kind's (a bank question reads "Question") */
  kindLabel?: string
  /** the accent label of a replay card: `REDO · PROBLEM`, `REDO · DESIGN`, `REDO · WRITE-UP` */
  redoLabel: string
}

const REPLAY_PROMPT: Partial<Record<Kind, string>> = {
  problem: 'Solve it again from a blank page. Write the pattern and the key idea first.',
  design: 'Run the design again. State the numbers before you draw.',
  writeup: 'Write it up again from a blank page. State the point first.',
}
/** A `journal_hard` redo with no explain question is a replay card on any kind of ticket; the kinds above keep their own sentence. */
const REPLAY_ANY = 'Do it again from a blank page. Write the key idea first.'

/** The reference answer to a ticket's first explain question: plan-authored, else a legacy brief's key ideas. */
export function storedAnswerOf(t: Ticket): string {
  const authored = t.explainAnswers?.[0]?.trim()
  if (authored) return authored
  return (t.brief?.questions?.[0]?.keyIdeas ?? []).join('; ')
}

const reviewLane = (t: Ticket): ReviewLane => {
  const l = tagLane(t)
  return l === 'dsa' || l === 'design' || l === 'career' ? l : 'path'
}

/**
 * Open redos due today or earlier on live tickets, oldest due first: the earliest local due day, ties broken by
 * `createdAt`, then ticket id (README "Oldest due"; the filter and order are `dueRedos`, shared with S2's `redoRows`). A redo on an archived ticket is skipped.
 */
export function reviewCards(a: { redos: readonly Redo[]; tickets: readonly Ticket[]; nowMs: number; bankArea?: BankAreaOf }): ReviewCard[] {
  return dueRedos(a.redos, a.tickets, a.nowMs).map(({ redo: r, ticket: t, dueDay }): ReviewCard => {
    // W6 (BANK-15): a bank question is a check card with no ticket; its lane is its question's area (design is Design, ai is AI)
    if (t === null) {
      const piece = bankPieceOf(r)!
      return {
        id: `redo:${r.id}`, redoId: r.id, stage: r.stage, ticketId: r.ticketId, kind: 'check', ticketKind: 'read', kindLabel: 'Question',
        title: piece.topic, lane: (a.bankArea?.(piece.qid, piece.topic) ?? 'ai') === 'design' ? 'design' : 'path', dueDay, ageDays: redoAgeDays(r, a.nowMs),
        prompt: piece.question, stored: piece.answer, to: '/banks', redoLabel: '',
      }
    }
    // F3: a weak spot kept from a design grade is a check card on its design ticket: the question, then the stored answer.
    // W2 (JOURNAL-23): a `journal_hard` redo with a piece is the same card on its own ticket, whatever the ticket's kind.
    const piece = isPieceSource(r.source) ? missedPieceOf(r) : null
    if (piece) {
      return {
        id: `redo:${r.id}`, redoId: r.id, stage: r.stage, ticketId: t.id, kind: 'check', ticketKind: t.kind,
        // R2: a lab review card is titled by the lab (piece.topic), not by its closing ticket
        title: r.source === 'lab_review' ? piece.topic : t.title, lane: reviewLane(t), dueDay, ageDays: redoAgeDays(r, a.nowMs),
        prompt: piece.question, stored: piece.answer, to: r.source === 'design_missed' ? `/designs/session/${t.id}` : `/do/${t.id}`,
        redoLabel: `REDO · ${KIND_LABEL[t.kind].toUpperCase()}`,
      }
    }
    // W2 (JOURNAL-21): a `journal_hard` redo with no piece is a replay card, whatever the ticket's kind
    const replay = r.source === 'journal_hard' || t.kind === 'problem' || t.kind === 'design' || t.kind === 'writeup'
    const design = t.kind === 'design' || t.kind === 'writeup'
    return {
      id: `redo:${r.id}`, redoId: r.id, stage: r.stage, ticketId: t.id, kind: replay ? 'replay' : 'check', ticketKind: t.kind,
      title: t.title, lane: reviewLane(t), dueDay, ageDays: redoAgeDays(r, a.nowMs),
      prompt: replay ? (REPLAY_PROMPT[t.kind] ?? REPLAY_ANY) : (t.explain?.[0] ?? `Explain "${t.title}" in your own words.`),
      stored: replay ? '' : storedAnswerOf(t),
      to: design ? `/designs/session/${t.id}` : `/do/${t.id}`,
      redoLabel: `REDO · ${KIND_LABEL[t.kind].toUpperCase()}`,
    }
  })
}

const daysLabel = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`

/** When the card is next due for each grade, from the same rules `gradeRedo` applies: Got it moves up one step (done after the last), Close is tomorrow, Missed it goes behind the other cards for this visit. */
export function gradeHint(stage: RedoStage, grade: Grade): string {
  if (grade === 'missed') return 'later'
  if (grade === 'close') return daysLabel(1)
  return stage === 2 ? 'done' : daysLabel(REDO_DAYS[stage + 1])
}

export const dueLabel = (days: number): string => (days <= 0 ? 'due today' : days === 1 ? 'due 1 day ago' : `due ${days} days ago`)

/** Lanes in the order the split shows them, each only when its count is above zero. */
const SPLIT_ORDER = ['path', 'dsa', 'design', 'career'] as const

export function queueMeta(cards: readonly ReviewCard[]): { count: number; oldest: string; split: string } {
  const oldestDays = cards.reduce((m, c) => Math.max(m, c.ageDays), 0)
  const split = SPLIT_ORDER
    .flatMap(l => { const n = cards.filter(c => c.lane === l).length; return n > 0 ? [`${LANE_LABEL[l]} ${n}`] : [] })
    .join(' · ')
  return { count: cards.length, oldest: oldestDays === 0 ? 'Oldest due today' : `Oldest ${oldestDays} ${oldestDays === 1 ? 'day' : 'days'}`, split }
}

/**
 * What a grade does to the redo. Got it moves it up one step (closed after the last); Close brings it back
 * tomorrow at the same step; Missed it changes nothing in the data (the card goes behind the others for this visit).
 */
export function gradeRedo(r: Redo, grade: Grade, nowMs: number): Redo {
  if (grade === 'missed') return r
  if (grade === 'close') return { ...r, due: addLocalDays(nowMs, 1) }
  const passed = [...r.passed, true]
  if (r.stage === 2) return { ...r, passed, closedAt: nowMs }
  const stage = (r.stage + 1) as 1 | 2
  return { ...r, passed, stage, due: redoDue(nowMs, stage) }
}

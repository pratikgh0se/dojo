import type { DesignSession, Outcome, Redo, RedoSource, Session, Ticket } from '../data/types'
import { DAY_MS, localDayKey, localDaysBetween, parseLocalDate } from '../lib/dates'
import { redesignQueue } from './designEvidence'
import type { PlanDesignRef } from './designs'
import { RUBRIC_MAX } from './designSession'
import { bankPieceOf } from './bankQuestions'
import { missedPieceOf } from './keepMissed'
import { needsRedo, passesRedo, REDO_DAYS, redoDue, redoRefund } from './ladder'
import { xpSavedText } from './ladderView'

/** PL "Motion and reward": Pom's power-up runs 2.5 s on a redo pass. */
export const REDO_POWERUP_MS = 2500
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A redo's due date as ms (a check-created redo stores the local date string). */
export const dueMs = (due: number | string): number => (typeof due === 'string' ? parseLocalDate(due) : due)

export function isRedoDue(r: Redo, nowMs: number): boolean {
  return r.closedAt === undefined && localDayKey(dueMs(r.due)) <= localDayKey(nowMs)
}

export function liveRedo(redos: Redo[], ticketId: string): Redo | null {
  return redos.find(r => r.ticketId === ticketId && r.closedAt === undefined) ?? null
}

export function refundWaiting(r: Redo): number {
  return redoRefund(r.stage, r.helpCost, r.refunded)
}

/** Problem tickets are titled "200 · Number of Islands"; the ladder and Redo drawer show the problem name. */
export function displayTitle(t: Pick<Ticket, 'kind' | 'title'>): string {
  return t.kind === 'problem' ? t.title.replace(/^\d+\s*·\s*/, '') : t.title
}

export function monDay(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}
export const givenUpText = (due: number): string => `Given up · redo due ${monDay(due)}`
export const redoBannerText = (stage: 0 | 1 | 2): string => `Redo · stage ${stage + 1} of 3 · Picture, Video and Solution cost double`

export type RedoEffect =
  | { kind: 'none' }
  | { kind: 'created' | 'reset'; redo: Redo; days: number }
  | { kind: 'pass'; redo: Redo; refund: number; complete: boolean; stageBefore: 0 | 1 | 2 }
  | { kind: 'fail'; redo: Redo; days: number; stageBefore: 0 | 1 | 2 }

export interface RedoOutcomeInput {
  live: Redo | null
  /** the session began while `live` was due (lib/cycle decides this at cycle start) */
  redoSession: boolean
  outcome: Outcome
  deepestRung: number
  /** help cost recorded in this session (the cycle's spend) */
  helpCost: number
  end: number
  ticketId: string
  newRedoId: string
}

/** C-LADDER §2.4. One live redo per ticket; a failed redo keeps its stage; a new qualifying session resets it. */
export function redoOutcome(i: RedoOutcomeInput): RedoEffect {
  const r = i.live
  if (i.redoSession && r) {
    if (passesRedo({ outcome: i.outcome, deepestRung: i.deepestRung })) {
      const refund = redoRefund(r.stage, r.helpCost, r.refunded)
      const passed = [...r.passed, true]
      if (r.stage === 2) return { kind: 'pass', refund, complete: true, stageBefore: 2, redo: { ...r, passed, closedAt: i.end } }
      const stage = (r.stage + 1) as 1 | 2
      return { kind: 'pass', refund, complete: false, stageBefore: r.stage, redo: { ...r, stage, passed, refunded: r.refunded + refund, due: redoDue(i.end, stage) } }
    }
    return { kind: 'fail', days: REDO_DAYS[r.stage], stageBefore: r.stage, redo: { ...r, passed: [...r.passed, false], due: redoDue(i.end, r.stage) } }
  }
  if (!needsRedo({ outcome: i.outcome, deepestRung: i.deepestRung })) return { kind: 'none' }
  const source: RedoSource = i.outcome === 'gave_up' ? 'gave_up' : 'solved_help'
  const fresh = { source, stage: 0 as const, due: redoDue(i.end, 0), passed: [], helpCost: i.helpCost, refunded: 0 }
  if (r) return { kind: 'reset', days: REDO_DAYS[0], redo: { ...r, ...fresh } }
  return { kind: 'created', days: REDO_DAYS[0], redo: { id: i.newRedoId, ticketId: i.ticketId, createdAt: i.end, ...fresh } }
}

export type DesignRedoEffect =
  | { kind: 'none' }
  | { kind: 'created' | 'closed' | 'rescheduled'; redo: Redo }

/** review.md Preconditions / REVIEW-15a: what a completed design session does to the design ticket's `design_rubric` redo.
 * `open` is the ticket's open redo (or null); `redesignDue` is the completed session's own (undefined when it needs none).
 * A redesign (`redesignOf` set) closes or reschedules an open `design_rubric` redo; any other completion with a redesign due
 * writes one redo only when the ticket has no open redo at all (at most one open redo per ticket). Pure. */
export function designRedoEffect(i: {
  open: Redo | null
  session: Pick<DesignSession, 'designId' | 'redesignOf'>
  redesignDue: number | undefined
  nowMs: number
  newRedoId: string
}): DesignRedoEffect {
  const r = i.open
  if (r && r.source === 'design_rubric' && i.session.redesignOf) {
    return i.redesignDue === undefined
      ? { kind: 'closed', redo: { ...r, passed: [...r.passed, true], closedAt: i.nowMs } }
      : { kind: 'rescheduled', redo: { ...r, passed: [...r.passed, false], due: i.redesignDue } }
  }
  if (r || i.redesignDue === undefined) return { kind: 'none' }
  return {
    kind: 'created',
    redo: { id: i.newRedoId, ticketId: i.session.designId, source: 'design_rubric', createdAt: i.nowMs, stage: 0, due: i.redesignDue, passed: [], helpCost: 0, refunded: 0 },
  }
}

/** Whole local calendar days from the redo's `due` day to the clock day (README "A redo's age"); 0 when due today.
 * Calendar arithmetic on the local day keys, so a DST day of 23 or 25 hours still counts as one day.
 * `review-oldest` must use `redoAgeDays` (not `RedoRow.days`, which counts days since the first try). */
export function redoAgeDays(r: Pick<Redo, 'due'>, nowMs: number): number {
  const dayNo = (key: string): number => {
    const [y, m, d] = key.split('-').map(Number)
    return Date.UTC(y, m - 1, d) / DAY_MS
  }
  return Math.max(0, Math.round(dayNo(localDayKey(nowMs)) - dayNo(localDayKey(dueMs(r.due)))))
}

export interface RedoRow { ticketId: string; title: string; days?: number; refund?: number; text: string; to: string }

/** Open redos due today or earlier on live (unarchived) tickets, oldest due first: the earliest local `due` day, ties broken by
 * `createdAt`, then ticket id (README "Oldest due"). The one filter and order behind Today's Redo drawer (`redoRows`) and Review's
 * queue (`reviewCards`), so the two can never disagree on what is due or in what order.
 * A `bank_q` redo (a question bank's Add to Review, BANK-14) has no ticket: its `ticketId` is a question id, it counts as not archived,
 * and its entry carries `ticket: null`. */
export function dueRedos(redos: readonly Redo[], tickets: readonly Ticket[], nowMs: number): { redo: Redo; ticket: Ticket | null; dueDay: string }[] {
  const byId = new Map(tickets.map(t => [t.id, t]))
  return redos
    .flatMap((redo): { redo: Redo; ticket: Ticket | null; dueDay: string }[] => {
      if (redo.source === 'bank_q') return bankPieceOf(redo) && isRedoDue(redo, nowMs) ? [{ redo, ticket: null, dueDay: localDayKey(dueMs(redo.due)) }] : []
      const ticket = byId.get(redo.ticketId)
      return ticket && !ticket.archived && isRedoDue(redo, nowMs) ? [{ redo, ticket, dueDay: localDayKey(dueMs(redo.due)) }] : []
    })
    .sort((a, b) => a.dueDay.localeCompare(b.dueDay) || a.redo.createdAt - b.redo.createdAt || a.redo.ticketId.localeCompare(b.redo.ticketId))
}

/** PL "Today": the Redo · N drawer lists redos due today or earlier, oldest due first (see `dueRedos`). */
export function redoRows(redos: Redo[], tickets: Ticket[], sessions: Session[], nowMs: number): RedoRow[] {
  const firstStart = new Map<string, number>()
  for (const s of sessions) {
    const f = firstStart.get(s.ticketId)
    if (f === undefined || s.start < f) firstStart.set(s.ticketId, s.start)
  }
  return dueRedos(redos, tickets, nowMs).map(({ redo: r, ticket: t }): RedoRow => {
    // W6 (BANK-15): a bank question is a Review card, not a ladder redo: it reads as its question and opens Review
    const bank = t === null ? bankPieceOf(r) : null
    if (t === null) return { ticketId: r.ticketId, title: bank?.topic ?? r.ticketId, text: `${bank?.topic ?? ''} · ${bank?.question ?? ''}`, to: '/review' }
    const title = displayTitle(t)
    // F3 (REVIEW-23): a kept weak spot is a Review card, not a ladder redo: it reads as its question and opens Review
    // W2: a `journal_hard` redo with a piece reads the same way (JOURNAL-23)
    const piece = r.source === 'design_missed' || r.source === 'journal_hard' ? missedPieceOf(r) : null
    if (piece) return { ticketId: t.id, title, text: `${title} · ${piece.question}`, to: '/review' }
    const days = localDaysBetween(firstStart.get(t.id) ?? r.createdAt, nowMs)
    const refund = refundWaiting(r)
    return { ticketId: t.id, title, days, refund, text: `${title} · ${days}d since first try · +${refund} xp waiting`, to: `/do/${t.id}` }
  })
}

export interface DesignRedoRow { designId: string; title: string; due: number; text: string; to: string }

/** C-INTEGRATION §7: Today's Redo drawer also lists redesigns already due (C-DESIGN D-46 `due`),
 * ordered by due date, as `{title} · redesign · previous rubric {n}/20`. Read side only. */
export function designRedoRows(designs: PlanDesignRef[], designSessions: DesignSession[], nowMs: number): DesignRedoRow[] {
  return redesignQueue(designs, designSessions, nowMs)
    .filter(r => r.state === 'due')
    .map(r => ({
      designId: r.designId, title: r.title, due: r.due,
      text: `${r.title} · redesign · previous rubric ${r.previousRubric}/${RUBRIC_MAX}`,
      to: `/designs/session/${r.designId}`,
    }))
}

export interface Feedback { text: string; tone: 'ok' | 'help'; flash: boolean; powerUp: boolean; powerUpMs?: number }

/** PL "Motion and reward" + C-LADDER §2.3/§2.4 toasts. */
export function outcomeFeedback(effect: RedoEffect, outcome: Outcome, xpDelta: number): Feedback {
  if (effect.kind === 'pass') {
    const text = effect.complete ? `+${effect.refund} xp bonus · redo complete` : `+${effect.refund} xp refunded`
    return { text, tone: 'ok', flash: true, powerUp: true, powerUpMs: REDO_POWERUP_MS }
  }
  if (effect.kind === 'fail') return { text: `Not yet. Redo again in ${effect.days} days.`, tone: 'help', flash: false, powerUp: false }
  if (outcome === 'gave_up') return { text: `Logged. Redo in ${REDO_DAYS[0]} days.`, tone: 'help', flash: false, powerUp: false }
  if (outcome === 'solved') return { text: xpSavedText(xpDelta), tone: 'ok', flash: true, powerUp: true }
  return { text: xpSavedText(xpDelta), tone: 'help', flash: true, powerUp: false }
}

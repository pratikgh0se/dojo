import type { DesignSession, Outcome, Redo, RedoSource, Session, Ticket } from '../data/types'
import { localDayKey, localDaysBetween, parseLocalDate } from '../lib/dates'
import { redesignQueue } from './designEvidence'
import type { PlanDesignRef } from './designs'
import { RUBRIC_MAX } from './designSession'
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

export interface RedoRow { ticketId: string; title: string; days?: number; refund?: number; text: string; to: string }

/** PL "Today": the Redo · N drawer lists redos due today or earlier. */
export function redoRows(redos: Redo[], tickets: Ticket[], sessions: Session[], nowMs: number): RedoRow[] {
  const byId = new Map(tickets.map(t => [t.id, t]))
  const firstStart = new Map<string, number>()
  for (const s of sessions) {
    const f = firstStart.get(s.ticketId)
    if (f === undefined || s.start < f) firstStart.set(s.ticketId, s.start)
  }
  return redos
    .filter(r => isRedoDue(r, nowMs))
    .flatMap(r => {
      const t = byId.get(r.ticketId)
      if (!t || t.archived) return []
      const title = displayTitle(t)
      const days = localDaysBetween(firstStart.get(t.id) ?? r.createdAt, nowMs)
      const refund = refundWaiting(r)
      return [{ due: dueMs(r.due), row: { ticketId: t.id, title, days, refund, text: `${title} · ${days}d since first try · +${refund} xp waiting`, to: `/do/${t.id}` } }]
    })
    .sort((a, b) => a.due - b.due || a.row.title.localeCompare(b.row.title))
    .map(x => x.row)
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

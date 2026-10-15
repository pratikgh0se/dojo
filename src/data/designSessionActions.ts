import type { DiagramJson, InterviewFinal } from '../ai/types'
import { newId } from '../lib/id'
import type { KitCanvas } from '../rules/designCanvas'
import { emptyCanvas, normalizeCanvas, syncTableNodes } from '../rules/designCanvas'
import type { DesignMode, DesignNotes } from '../rules/designDigest'
import { readDesignMode } from '../rules/designMode'
import { emptyNotes, renameTable } from '../rules/designNotes'
import { PARTNER_NOTES_MAX } from '../rules/partnerScores'
import { outstandingFor } from '../rules/designEvidence'
import { keepRedos } from '../rules/keepMissed'
import { designRedoEffect } from '../rules/redoQueue'
import {
  applyPause, applyResume, cappedDive, EMPTY_CLOSE, isOverdue, lockAt, needsRedesign, prefillFromFinal, redesignDueAt, scoreReady, seedTradeoffs,
} from '../rules/designSession'
import { moveTicket } from './boardActions'
import type { DojoDB } from './db'
import type { CloseAnswers, DesignSession, PartnerScores } from './types'

type Phase = DesignSession['phase']
type Msg = { from: 'interviewer' | 'you'; text: string; hint?: true }

/** Read-modify-write one row inside a transaction when its phase is allowed. */
async function patchIf(d: DojoDB, id: string, phases: Phase[], fn: (s: DesignSession) => DesignSession): Promise<boolean> {
  return d.transaction('rw', d.designSessions, async () => {
    const s = await d.designSessions.get(id)
    if (!s || !phases.includes(s.phase)) return false
    await d.designSessions.put(fn(s))
    return true
  })
}

const LIVE: Phase[] = ['drawing', 'close', 'score']

type StartArgs = { designId: string; mode: DesignMode | 'interviewer'; deepDives: string[]; nowMs: number; redesignOf?: string }

/** The row a new session would start with, or null when one is already open on the design. A redo started from a finished session names that
 * session; otherwise the newest redesign still outstanding. Pure, so the screen can show the session the moment Start is pressed. */
export function newDesignSessionRow(all: DesignSession[], a: StartArgs): DesignSession | null {
  if (all.some(s => s.designId === a.designId && s.phase !== 'done')) return null
  const mine = all.filter(s => s.designId === a.designId)
  const from = a.redesignOf ? mine.find(s => s.id === a.redesignOf && s.phase === 'done') : undefined
  const redo = from ?? outstandingFor(mine, a.designId)
  const mode = readDesignMode(a.mode)
  return {
    id: newId('ds', a.nowMs), designId: a.designId, at: a.nowMs, phase: 'drawing', minutes: 0, mode, view: '2d',
    canvas: emptyCanvas(), notes: emptyNotes(), close: { ...EMPTY_CLOSE, tradeoff: { ...EMPTY_CLOSE.tradeoff } },
    deepDives: a.deepDives.map(q => ({ q, answered: null })), tradeoffs: [], rubric: null, lenses: {},
    ...(mode === 'ai-partner' ? { interview: { messages: [] } } : {}),
    ...(mode === 'human-partner' ? { partner: {} } : {}),
    ...(redo ? { redesignOf: redo.id } : {}),
  }
}

/** `row` is the session the screen already shows (newDesignSessionRow): it is stored as is, so the id the screen holds is the stored id. */
export async function startDesignSession(d: DojoDB, a: StartArgs & { row?: DesignSession }): Promise<DesignSession> {
  return d.transaction('rw', d.designSessions, async () => {
    const all = await d.designSessions.where('designId').equals(a.designId).toArray()
    const open = all.find(s => s.phase !== 'done')
    if (open) return open
    const row = a.row ?? newDesignSessionRow(all, a)!
    await d.designSessions.add(row)
    return row
  })
}

export const saveCanvas = (d: DojoDB, id: string, canvas: KitCanvas) => patchIf(d, id, ['drawing'], s => ({ ...s, canvas }))
export const saveNotes = (d: DojoDB, id: string, notes: DesignNotes) => patchIf(d, id, ['drawing'], s => ({ ...s, notes }))
export const saveView = (d: DojoDB, id: string, view: '2d' | 'iso') => patchIf(d, id, LIVE, s => ({ ...s, view }))

/** The partner card's writes: the friend scores while the host draws, closes and scores, so every live phase is open. */
export function savePartner(d: DojoDB, id: string, patch: { name?: string; scores?: PartnerScores; notes?: string }, nowMs: number): Promise<boolean> {
  return d.transaction('rw', d.designSessions, async () => {
    const s = await d.designSessions.get(id)
    if (!s || !LIVE.includes(s.phase) || readDesignMode(s.mode) !== 'human-partner') return false
    const prev = s.partner ?? {}
    const next = patch.notes === undefined ? patch : { ...patch, notes: patch.notes.slice(0, PARTNER_NOTES_MAX) }
    await d.designSessions.put({ ...s, partner: { ...prev, ...next, at: prev.at ?? nowMs } })
    return true
  })
}

/** A table whose name was cleared and never left the box (the lock came first) takes its id, as leaving the box does. */
function nameBlankTables(s: DesignSession): DesignSession {
  const notes = s.notes
  if (!notes?.schema?.some(t => !t.name.trim())) return s
  const fixed = notes.schema.reduce((n, t) => (t.name.trim() ? n : renameTable(n, t.id, t.id)), notes)
  return { ...s, notes: fixed, canvas: syncTableNodes(normalizeCanvas(s.canvas), fixed) }
}

export function lockDesignSession(d: DojoDB, id: string, nowMs: number): Promise<boolean> {
  return patchIf(d, id, ['drawing'], s => {
    // an open pause was folded into pausedMs by lockAt: the stored row carries no pausedAt once locked
    const { pausedAt: _open, ...rest } = { ...nameBlankTables(s), ...lockAt(s, nowMs), phase: 'close' as const }
    return rest
  })
}

/** Pause stops the 45-minute clock (F2); only while drawing, and not once the time is already up. */
export async function pauseDesignSession(d: DojoDB, id: string, nowMs: number): Promise<boolean> {
  let done = false
  await patchIf(d, id, ['drawing'], s => {
    if (s.pausedAt != null || isOverdue(s, nowMs)) return s
    done = true
    return applyPause(s, nowMs)
  })
  return done
}

/** Resume starts the clock again; the pause joins `pausedMs`. */
export async function resumeDesignSession(d: DojoDB, id: string, nowMs: number): Promise<boolean> {
  let done = false
  await patchIf(d, id, ['drawing'], s => {
    if (s.pausedAt == null) return s
    done = true
    return applyResume(s, nowMs)
  })
  return done
}

/**
 * D-23 addendum: the last canvas edit is queued, not written synchronously (useWriteQueue), so a
 * queued `saveCanvas` can still be sitting in the chain when a lock fires. `saveCanvas` is guarded
 * by patchIf(['drawing']): once the lock has already moved the session to 'close', that queued
 * write silently no-ops and the edit is lost. Flush the queue first so the canvas write lands
 * while the session is still in 'drawing', then lock. Used by both the 45:00 auto-lock and the
 * End-drawing confirm.
 */
export async function flushThenLock(d: DojoDB, id: string, nowMs: number, flush: () => Promise<void>): Promise<boolean> {
  await flush()
  return lockDesignSession(d, id, nowMs)
}

export async function discardDesignSession(d: DojoDB, id: string): Promise<boolean> {
  return d.transaction('rw', d.designSessions, async () => {
    const s = await d.designSessions.get(id)
    if (!s || s.phase === 'done') return false
    await d.designSessions.delete(id)
    return true
  })
}

export const saveClose = (d: DojoDB, id: string, close: CloseAnswers) => patchIf(d, id, ['close'], s => ({ ...s, close }))

export function enterScore(d: DojoDB, id: string, close: CloseAnswers): Promise<boolean> {
  return patchIf(d, id, ['close'], s => ({ ...s, close, phase: 'score', tradeoffs: seedTradeoffs(close, s.tradeoffs) }))
}

export function saveScore(
  d: DojoDB, id: string, patch: Partial<Pick<DesignSession, 'deepDives' | 'lenses' | 'tradeoffs' | 'rubric' | 'rubricBy'>>,
): Promise<boolean> {
  return patchIf(d, id, ['score'], s => ({ ...s, ...patch }))
}

/** Learner messages only while drawing; interviewer replies until the session is done. */
export function appendInterview(d: DojoDB, id: string, messages: Msg[]): Promise<boolean> {
  const phases: Phase[] = messages.some(m => m.from === 'you') ? ['drawing'] : LIVE
  return patchIf(d, id, phases, s => ({
    ...s, interview: { ...(s.interview ?? { messages: [] }), messages: [...(s.interview?.messages ?? []), ...messages] },
  }))
}

/** Stores the model grade and prefills dives (Q4-capped), lenses and rubric; the learner may override. */
export function saveFinal(d: DojoDB, id: string, final: InterviewFinal): Promise<boolean> {
  return patchIf(d, id, ['score'], s => ({
    ...s,
    ...prefillFromFinal(final, s.deepDives, cappedDive(s.close)),
    rubricBy: 'model',
    interview: { ...(s.interview ?? { messages: [] }), final },
  }))
}

export type KeepResult = { ok: true; count: number } | { ok: false; reason: 'missing' | 'none' | 'kept' }

/**
 * "Keep what you missed" (DESIGN-103): one `design_missed` redo per weak spot of a finished ai-partner session's stored grade, and the
 * session's `keptAt`. The redo ids are fixed (`keep-<sessionId>-<k>`), so a second call writes nothing; a user action only, never on load.
 */
export async function keepMissedSpots(d: DojoDB, id: string, nowMs: number): Promise<KeepResult> {
  return d.transaction('rw', [d.designSessions, d.redos], async (): Promise<KeepResult> => {
    const s = await d.designSessions.get(id)
    if (!s || s.phase !== 'done') return { ok: false, reason: 'missing' }
    if (s.keptAt !== undefined) return { ok: false, reason: 'kept' }
    const rows = keepRedos(s, nowMs)
    if (rows.length === 0) return { ok: false, reason: 'none' }
    for (const r of rows) if (!(await d.redos.get(r.id))) await d.redos.add(r)
    await d.designSessions.put({ ...s, keptAt: nowMs })
    return { ok: true, count: rows.length }
  })
}

export const saveReference = (d: DojoDB, id: string, reference: DiagramJson) =>
  patchIf(d, id, ['done'], s => ({ ...s, reference }))

export type CompleteResult = { ok: true; xpDelta: number; redesignDue?: number } | { ok: false; reason: 'missing' | 'not-ready' }

export async function completeDesignSession(d: DojoDB, id: string, nowMs: number): Promise<CompleteResult> {
  // rungUses is needed by moveTicket's own transaction (I2: Board's Done move uses the same
  // one XP function as the ladder, whose netOf reads rungUses); nest it here so completing a
  // design session doesn't hit "Table rungUses not included in parent transaction."
  return d.transaction('rw', [d.designSessions, d.tickets, d.events, d.rungUses, d.redos], async (): Promise<CompleteResult> => {
    const s = await d.designSessions.get(id)
    if (!s || s.phase !== 'score') return { ok: false, reason: 'missing' }
    if (!scoreReady(s)) return { ok: false, reason: 'not-ready' }
    const redesignDue = needsRedesign(s.rubric as number, s.deepDives) ? redesignDueAt(nowMs) : undefined
    const next: DesignSession = { ...s, phase: 'done', endedAt: nowMs }
    if (redesignDue === undefined) delete next.redesignDue
    else next.redesignDue = redesignDue
    await d.designSessions.put(next)
    // review.md Preconditions / REVIEW-15a: a due redesign is a redo on the design ticket, so Review and its badge see it.
    // No back-fill: only sessions completed here write one.
    // DESIGN-107: the one-open-redo rule counts `design_rubric` rows only; kept weak spots (`design_missed`) never block or stand in for it
    const open = (await d.redos.where('ticketId').equals(s.designId).toArray()).find(r => r.closedAt === undefined && r.source === 'design_rubric') ?? null
    const fx = designRedoEffect({ open, session: s, redesignDue, nowMs, newRedoId: newId('r', nowMs) })
    if (fx.kind === 'created') await d.redos.add(fx.redo)
    else if (fx.kind !== 'none') await d.redos.put(fx.redo)
    // Controller ruling (cu-r3 A15): a completed design/interviewer session counts its timed minutes as focus minutes,
    // one `focus` event, minus any focus blocks already finished on this design ticket during the session (no double count).
    const timed = Math.max(0, Math.floor(s.minutes) || 0)
    if (timed > 0) {
      const already = (await d.events.where('id').equals(s.designId).toArray())
        .filter(e => e.t === 'focus' && e.at >= s.at && e.at <= nowMs)
        .reduce((a, e) => a + (e.t === 'focus' ? e.minutes : 0), 0)
      const extra = timed - already
      if (extra > 0) await d.events.add({ t: 'focus', id: s.designId, at: nowMs, minutes: extra, sid: s.id, block: 0 })
    }
    let xpDelta = 0
    const t = await d.tickets.get(s.designId)
    if (t && !t.archived && t.status !== 'done') {
      const r = await moveTicket(d, t.id, 'done', nowMs)
      if (r.ok) xpDelta = r.xpDelta
    }
    return { ok: true, xpDelta, redesignDue }
  })
}

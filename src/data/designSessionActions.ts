import type { DiagramJson, InterviewFinal } from '../ai/types'
import { newId } from '../lib/id'
import type { KitCanvas } from '../rules/designCanvas'
import { emptyCanvas } from '../rules/designCanvas'
import { outstandingFor } from '../rules/designEvidence'
import {
  cappedDive, EMPTY_CLOSE, lockAt, needsRedesign, prefillFromFinal, redesignDueAt, scoreReady, seedTradeoffs,
} from '../rules/designSession'
import { moveTicket } from './boardActions'
import type { DojoDB } from './db'
import type { CloseAnswers, DesignSession } from './types'

type Phase = DesignSession['phase']
type Msg = { from: 'interviewer' | 'you'; text: string }

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

export async function startDesignSession(
  d: DojoDB, a: { designId: string; mode: 'solo' | 'interviewer'; deepDives: string[]; nowMs: number },
): Promise<DesignSession> {
  return d.transaction('rw', d.designSessions, async () => {
    const all = await d.designSessions.where('designId').equals(a.designId).toArray()
    const open = all.find(s => s.phase !== 'done')
    if (open) return open
    const redo = outstandingFor(all, a.designId)
    const row: DesignSession = {
      id: newId('ds', a.nowMs), designId: a.designId, at: a.nowMs, phase: 'drawing', minutes: 0, mode: a.mode, view: '2d',
      canvas: emptyCanvas(), close: { ...EMPTY_CLOSE, tradeoff: { ...EMPTY_CLOSE.tradeoff } },
      deepDives: a.deepDives.map(q => ({ q, answered: null })), tradeoffs: [], rubric: null, lenses: {},
      ...(a.mode === 'interviewer' ? { interview: { messages: [] } } : {}),
      ...(redo ? { redesignOf: redo.id } : {}),
    }
    await d.designSessions.add(row)
    return row
  })
}

export const saveCanvas = (d: DojoDB, id: string, canvas: KitCanvas) => patchIf(d, id, ['drawing'], s => ({ ...s, canvas }))
export const saveView = (d: DojoDB, id: string, view: '2d' | 'iso') => patchIf(d, id, LIVE, s => ({ ...s, view }))

export function lockDesignSession(d: DojoDB, id: string, nowMs: number): Promise<boolean> {
  return patchIf(d, id, ['drawing'], s => ({ ...s, ...lockAt(s, nowMs), phase: 'close' }))
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

export const saveReference = (d: DojoDB, id: string, reference: DiagramJson) =>
  patchIf(d, id, ['done'], s => ({ ...s, reference }))

export type CompleteResult = { ok: true; xpDelta: number; redesignDue?: number } | { ok: false; reason: 'missing' | 'not-ready' }

export async function completeDesignSession(d: DojoDB, id: string, nowMs: number): Promise<CompleteResult> {
  // rungUses is needed by moveTicket's own transaction (I2: Board's Done move uses the same
  // one XP function as the ladder, whose netOf reads rungUses); nest it here so completing a
  // design session doesn't hit "Table rungUses not included in parent transaction."
  return d.transaction('rw', [d.designSessions, d.tickets, d.events, d.rungUses], async (): Promise<CompleteResult> => {
    const s = await d.designSessions.get(id)
    if (!s || s.phase !== 'score') return { ok: false, reason: 'missing' }
    if (!scoreReady(s)) return { ok: false, reason: 'not-ready' }
    const redesignDue = needsRedesign(s.rubric as number, s.deepDives) ? redesignDueAt(nowMs) : undefined
    const next: DesignSession = { ...s, phase: 'done', endedAt: nowMs }
    if (redesignDue === undefined) delete next.redesignDue
    else next.redesignDue = redesignDue
    await d.designSessions.put(next)
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

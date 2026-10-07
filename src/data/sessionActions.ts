import { moveTicket, type ActionResult } from './boardActions'
import type { DojoDB } from './db'
import type { EndLog, Outcome, Session } from './types'
import { newId } from '../lib/id'
import { needsCheck } from '../rules/brief'
import { closeSessionResult } from '../rules/session'

export async function startDoing(d: DojoDB, id: string, now: number): Promise<ActionResult> {
  const t = await d.tickets.get(id)
  if (!t || t.archived) return { ok: false, reason: 'missing', message: 'Ticket not found' }
  if (t.status === 'doing' || t.status === 'done') return { ok: true, xpDelta: 0 }
  return moveTicket(d, id, 'doing', now)
}

export type CloseOutcome = { ok: true; xpDelta: number; session: Session } | { ok: false; reason: string; message: string }

export async function closeSession(
  d: DojoDB,
  ticketId: string,
  outcome: Outcome,
  opts: { sessionStart: number; now: number; notes?: string; proof?: { repo?: string; note?: string }; sessionId?: string },
): Promise<CloseOutcome> {
  return d.transaction('rw', d.tickets, d.sessions, d.events, async (): Promise<CloseOutcome> => {
    const t = await d.tickets.get(ticketId)
    if (!t) return { ok: false, reason: 'missing', message: 'Ticket not found' }
    if (t.archived) return { ok: false, reason: 'archived', message: 'Ticket is archived' }
    if (outcome !== 'gave_up' && needsCheck(t)) return { ok: false, reason: 'check_required', message: 'Check your understanding first' }
    const r = closeSessionResult({
      ticket: t,
      outcome,
      sessionStart: opts.sessionStart,
      now: opts.now,
      notes: opts.notes,
      proof: opts.proof,
      sessionId: opts.sessionId ?? newId('s', opts.now),
    })
    await d.tickets.put(r.ticket)
    await d.sessions.add(r.session)
    if (r.event) await d.events.add(r.event)
    return { ok: true, xpDelta: r.session.xpDelta, session: r.session }
  })
}

export const END_LOG_MAX = 280

/**
 * A finished focus block: a health signal on the ticket. It carries no XP and never goes near netOf.
 * With `sid` and `block` it is idempotent, checked inside the transaction, so two tabs crediting the
 * same block of the same session write one event.
 */
export async function recordFocus(
  d: DojoDB, i: { ticketId: string; at: number; minutes: number; sid?: string; block?: number },
): Promise<void> {
  if (!Number.isFinite(i.minutes) || i.minutes <= 0) return
  await d.transaction('rw', d.events, async () => {
    if (i.sid !== undefined && i.block !== undefined) {
      const seen = await d.events.where('id').equals(i.ticketId).filter(e => e.t === 'focus' && e.sid === i.sid && e.block === i.block).count()
      if (seen > 0) return
    }
    await d.events.add({ t: 'focus', id: i.ticketId, at: i.at, minutes: i.minutes, ...(i.sid !== undefined ? { sid: i.sid, block: i.block } : {}) })
  })
}

const clean = (s: string | undefined): string => (s ?? '').trim().slice(0, END_LOG_MAX)

export type EndStudyResult = { ok: true; session: Session } | { ok: false; reason: string; message: string }

/**
 * Ends a study session: one `sessions` row, outcome `studied`, xpDelta 0. The ticket, the ledger and
 * every event are left alone (XP stays through netOf, which only a rung, a redo or a tick moves).
 */
export async function endStudySession(
  d: DojoDB,
  i: {
    ticketId: string; start: number; now: number; goal?: string; cards: string[]; focusMinutes: number
    endLog: Partial<EndLog>; sessionId?: string
  },
): Promise<EndStudyResult> {
  return d.transaction('rw', d.tickets, d.sessions, async (): Promise<EndStudyResult> => {
    const t = await d.tickets.get(i.ticketId)
    if (!t) return { ok: false, reason: 'missing', message: 'Ticket not found' }
    if (i.sessionId && (await d.sessions.get(i.sessionId))) return { ok: false, reason: 'duplicate', message: 'Session already saved' }
    const start = Math.min(i.start, i.now)
    const goal = i.goal?.trim()
    const session: Session = {
      id: i.sessionId ?? newId('s', i.now), ticketId: t.id, start, end: i.now,
      minutes: Math.max(0, Math.round((i.now - start) / 60_000)),
      outcome: 'studied', xpDelta: 0,
      ...(goal ? { goal } : {}),
      cards: i.cards, focusMinutes: Math.max(0, Math.round(i.focusMinutes)),
      endLog: { done: clean(i.endLog.done), stuckOn: clean(i.endLog.stuckOn), nextStep: clean(i.endLog.nextStep) },
    }
    await d.sessions.add(session)
    return { ok: true, session }
  })
}

import type { DojoDB } from './db'
import { closeLadderSession, netOf } from './ladderActions'
import type { Outcome } from './types'
import { clampNote } from '../rules/kanban'

export type NoteResult = { ok: true; changed: boolean } | { ok: false; message: string }

/**
 * BOARD-20: saves the one-line reason on a blocked or need-help ticket. Trimmed, at most 140 characters. A blank text writes nothing,
 * except that it removes a note the ticket already had. Only the `blockedNote` field changes.
 */
export async function saveBlockedNote(d: DojoDB, id: string, raw: string): Promise<NoteResult> {
  return d.transaction('rw', d.tickets, async (): Promise<NoteResult> => {
    const t = await d.tickets.get(id)
    if (!t || t.archived) return { ok: false, message: 'Ticket not found' }
    if (t.status !== 'blocked' && t.status !== 'help') return { ok: false, message: 'Only a blocked or need-help ticket has a reason' }
    const note = clampNote(raw)
    if (note === (t.blockedNote ?? '')) return { ok: true, changed: false }
    if (note === '') {
      const { blockedNote: _gone, ...rest } = t
      await d.tickets.put(rest)
    } else {
      await d.tickets.put({ ...t, blockedNote: note })
    }
    return { ok: true, changed: true }
  })
}

export type FinishProblemResult = { ok: true; xpDelta: number } | { ok: false; message: string }

/**
 * BOARD-25 to BOARD-28: a problem moved to Done on the Board. The learner says how it went first; the write is the one the ticket view's
 * Solved / Solved with help / Gave up makes (closeLadderSession), with no help rung opened. "Gave up" leaves the ticket `todo`, writes a
 * `gave_up` session and one open redo (stage 0, due in three days).
 */
export async function finishProblem(d: DojoDB, id: string, outcome: Extract<Outcome, 'solved' | 'solved_help' | 'gave_up'>, now: number): Promise<FinishProblemResult> {
  return d.transaction('rw', [d.tickets, d.sessions, d.events, d.rungUses, d.redos], async (): Promise<FinishProblemResult> => {
    const t = await d.tickets.get(id)
    if (!t || t.archived) return { ok: false, message: 'Ticket not found' }
    if (t.status === 'done') return { ok: false, message: 'That ticket is already done' }
    const netAtStart = await netOf(d, t)
    const r = await closeLadderSession(d, {
      ticketId: id, outcome, attemptStart: now, cycleId: '', sessionStart: now, now, netAtStart, redoId: null,
      sessionId: `s-done-${id}-${now}`, checkPass: false,
    })
    return r.ok ? { ok: true, xpDelta: r.xpDelta } : { ok: false, message: r.message }
  })
}

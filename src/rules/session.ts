import type { DojoEvent, Outcome, Session, Ticket } from '../data/types'
import { baseXp } from './xp'

export interface CloseInput {
  ticket: Ticket
  outcome: Outcome
  sessionStart: number
  now: number
  notes?: string
  proof?: { repo?: string; note?: string }
  sessionId: string
  /** Net XP to award instead of the ticket's gross base (C-LADDER: the ladder close's tick
   * event must record the same net the ticket ends up with, via the single ledger function
   * netOf - not the gross baseXp). Callers without a ledger (e.g. the plain session flow)
   * omit this and fall back to gross base. */
  net?: number
}

export interface CloseResult { ticket: Ticket; session: Session; event: DojoEvent | null }

export function closeSessionResult(i: CloseInput): CloseResult {
  const start = Math.min(i.sessionStart, i.now)
  const minutes = Math.max(0, Math.round((i.now - start) / 60_000))
  let ticket: Ticket = { ...i.ticket }

  const repo = i.proof?.repo?.trim()
  const note = i.proof?.note?.trim()
  if (repo || note) ticket.proof = { ...ticket.proof, ...(repo ? { repo } : {}), ...(note ? { note } : {}) }

  let xpDelta = 0
  let event: DojoEvent | null = null
  if (i.outcome === 'gave_up') {
    if (ticket.status !== 'done') ticket.status = 'todo'
  } else if (ticket.status !== 'done') {
    const xp = i.net ?? baseXp(ticket.kind, ticket.difficulty)
    ticket = { ...ticket, status: 'done', doneAt: i.now, doneAtApprox: false, xp }
    xpDelta = xp
    event = { t: 'tick', id: ticket.id, at: i.now, xp }
  }

  const notes = i.notes?.trim()
  const session: Session = {
    id: i.sessionId,
    ticketId: ticket.id,
    start,
    end: i.now,
    minutes,
    outcome: i.outcome,
    xpDelta,
    ...(notes ? { notes } : {}),
  }
  return { ticket, session, event }
}

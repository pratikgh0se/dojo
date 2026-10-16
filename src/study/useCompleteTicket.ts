import { useCallback } from 'react'
import { useDb, usePlanV2 } from '../app/providers'
import { moveTicket } from '../data/boardActions'
import { submitExplainCheck } from '../data/checkActions'
import { syncGate, type DojoDB } from '../data/db'
import { closeLadderSession } from '../data/ladderActions'
import { safeWrite } from '../data/safeWrite'
import type { Ticket } from '../data/types'
import { isReadOnly, READ_ONLY_MESSAGE } from '../data/writer'
import { playChime } from '../lib/chime'
import { CHECK_REDO_DAYS } from '../rules/check'
import { loadCycle } from '../lib/cycle'
import { now } from '../lib/clock'
import { loadStudy } from '../lib/studyStore'
import { loadTimer } from '../lib/timer'
import { useFlash, usePowerUp, useToast } from '../ui/primitives'
import { closeStudyOnCheckPass } from './runner'

/**
 * After Done: the saved explain answers go to the check job. Never awaited by Done and never throws: the check is optional,
 * so an unavailable AI, a skipped check or a failed write is dropped silently. Nothing runs where the write would be refused
 * (read-only browser, model gate), so no AI call is spent on an attempt that could not be stored.
 */
async function runExplainCheck(d: DojoDB, ticket: Ticket, at: number, toast: (m: string) => void, topic?: string): Promise<void> {
  if (syncGate.readOnly || syncGate.modelLocked) return
  try {
    const n = ticket.explain?.length ?? 0
    if (n === 0) return
    const fresh = await d.tickets.get(ticket.id) // the saved answers; the ticket view flushes its draft before calling Done
    const answers = Array.from({ length: n }, (_, i) => fresh?.explainResponses?.[i] ?? '')
    const r = await submitExplainCheck(d, ticket.id, answers, at, topic)
    if (r.ok && !r.passed) toast(`Your answers come back in Review in ${CHECK_REDO_DAYS} days.`)
  } catch {
    // The check is optional and Done has already landed. This swallows an AI failure and also a write that failed because
    // storage is full (the quota case): the learner keeps the finished ticket and its XP, and the check is simply not stored.
  }
}

/**
 * Done: the one completion path of every kind but a problem. XP by kind, one session row, the timer ends.
 * Done never waits for a learning check (TICKET-16), whatever a legacy brief says.
 */
export function useCompleteTicket(): (ticket: Ticket) => Promise<boolean> {
  const d = useDb()
  const toast = useToast()
  const flash = useFlash()
  const { fire: powerUp } = usePowerUp()
  const plan = usePlanV2()
  const complete = useCallback(async (ticket: Ticket) => {
    if (isReadOnly()) { toast(READ_ONLY_MESSAGE, 'danger'); return false }
    const at = now()
    // read the fresh ticket, not the caller's copy: what it was and whether anything is open for it decide the session row
    const prior = await d.tickets.get(ticket.id)
    const openTimer = loadTimer()
    const hasOpen = loadStudy()?.ticketId === ticket.id || (openTimer?.ticketId === ticket.id) || loadCycle(ticket.id) !== null
    // Nothing open (an unstarted ritual, a doing ticket whose session already ended): Done still leaves one session row (TICKET-10),
    // written in the same transaction as the move so the two land together or not at all. A ticket already done gets no second row.
    const fallback = !hasOpen && !!prior && prior.status !== 'done'
    let res: Awaited<ReturnType<typeof moveTicket>> | undefined
    try {
      res = await safeWrite(() => fallback
        ? d.transaction('rw', [d.tickets, d.sessions, d.events, d.rungUses, d.redos], async () => {
            // re-read inside the transaction: a second Done racing this one must not close the ticket twice
            const cur = await d.tickets.get(ticket.id)
            if (!cur || cur.status === 'done') return moveTicket(d, ticket.id, 'done', at)
            const moved = await moveTicket(d, ticket.id, 'done', at)
            if (!moved.ok) return moved
            const closed = await closeLadderSession(d, {
              ticketId: ticket.id, outcome: 'solved', checkPass: true, attemptStart: at, sessionStart: at, now: at,
              cycleId: '', redoId: null, netAtStart: cur.xp, sessionId: `s-done-${ticket.id}-${at}`,
            })
            if (!closed.ok) throw new Error(closed.message) // rolls the move back with it
            return moved
          })
        : moveTicket(d, ticket.id, 'done', at), m => toast(m, 'danger'))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not mark it done', 'danger')
      return false
    }
    if (!res) return false
    if (!res.ok) { toast(res.message, 'danger'); return false }
    if (res.xpDelta > 0) { flash(); powerUp(); toast(`+${res.xpDelta} xp · Saved`) }
    await closeStudyOnCheckPass({ d, ticketId: ticket.id, nowMs: at, xpDelta: res.xpDelta, chime: () => void playChime(), toast, onError: m => toast(m, 'danger') })
    // only the call that made the move runs the check: a ticket that was already done (a second Done) is never checked again
    if (prior && prior.status !== 'done') void runExplainCheck(d, ticket, at, m => toast(m), plan?.nodes.find(n => n.id === ticket.node)?.title)
    return true
  }, [d, flash, plan, powerUp, toast])
  // never rejects: a read or a close that throws outside the guarded write is one short toast, not an unhandled rejection
  return useCallback(async (ticket: Ticket) => {
    try { return await complete(ticket) } catch {
      toast('Could not finish that ticket. Try again.', 'danger')
      return false
    }
  }, [complete, toast])
}

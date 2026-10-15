import { useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDb } from '../app/providers'
import { getSettings } from '../data/db'
import { safeWrite } from '../data/safeWrite'
import { startDoing } from '../data/sessionActions'
import type { Ticket } from '../data/types'
import { isReadOnly, READ_ONLY_MESSAGE } from '../data/writer'
import { playChime, primeChime } from '../lib/chime'
import { now } from '../lib/clock'
import { loadChimePref, loadStudy } from '../lib/studyStore'
import { planFor } from '../rules/sessionPlan'
import { useToast } from '../ui/primitives'
import { beginStudy, finishStudy } from './runner'

/** Where a ticket is worked: design and write-up tickets open the design session, every other kind the ticket view. */
export const sessionRouteFor = (t: Pick<Ticket, 'id' | 'kind'>): string =>
  t.kind === 'design' || t.kind === 'writeup' ? `/designs/session/${t.id}` : `/do/${t.id}`

/**
 * The one way to start a ticket (Today, Path, the pick list, a skill node, the ticket view): one session at the
 * remembered length, the ticket marked doing, then the ticket opens. Its order never changes. Design and write-up
 * tickets are marked doing and open their design session; they start no study timer.
 */
export function useStartTicket(): (ticket: Ticket) => Promise<boolean> {
  const d = useDb()
  const toast = useToast()
  const navigate = useNavigate()
  const inFlight = useRef(false)
  const startInner = useCallback(async (ticket: Ticket) => {
    if (isReadOnly()) { toast(READ_ONLY_MESSAGE, 'danger'); return false }
    const route = sessionRouteFor(ticket)
    if (ticket.kind === 'design' || ticket.kind === 'writeup') {
      if (ticket.status !== 'done') {
        const r = await safeWrite(() => startDoing(d, ticket.id, now()), m => toast(m, 'danger'))
        if (!r) return false
        if (!r.ok) { toast(r.message, 'danger'); return false }
      }
      navigate(route)
      return true
    }
    const running = loadStudy()
    if (running && running.ticketId === ticket.id) { navigate(route); return true }
    if (running) {
      // One timer at a time, and starting another ticket always works (PATH-18, TICKET-08): the session on the other ticket is saved
      // quietly as it stands (its time so far, no end note) and the new one begins. That ticket stays doing; nothing is lost or blocked.
      const ended = await finishStudy({ d, log: {}, nowMs: now(), chime: () => {}, toast, onError: m => toast(m, 'danger') })
      if (!ended) return false
    }
    const chime = loadChimePref()
    if (chime) primeChime()
    const ok = await beginStudy({
      d, ticket, plan: planFor(ticket, await getSettings(d), chime), nowMs: now(),
      chime: () => void playChime(), toast, onError: m => toast(m, 'danger'),
    })
    if (ok) navigate(route)
    return ok
  }, [d, navigate, toast])
  // safeWrite rethrows what it does not absorb (not a quota or read-only refusal): never let that leave as an unhandled rejection
  const start = useCallback(async (ticket: Ticket) => {
    try { return await startInner(ticket) } catch {
      toast('Could not start that ticket. Try again.', 'danger')
      return false
    }
  }, [startInner, toast])
  // two quick clicks start one session: a second call while the first is still writing does nothing
  return useCallback(async (ticket: Ticket) => {
    if (inFlight.current) return false
    inFlight.current = true
    try { return await start(ticket) } finally { inFlight.current = false }
  }, [start])
}

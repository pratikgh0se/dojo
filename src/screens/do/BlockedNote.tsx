import type { Ticket } from '../../data/types'

/** TICKET-37: "Blocked[: note]" / "Needs help[: note]" on a ticket whose status is blocked or help; nothing on any other ticket. */
export function BlockedNote({ ticket, className }: { ticket: Pick<Ticket, 'status' | 'blockedNote'>; className?: string }) {
  if (ticket.status !== 'blocked' && ticket.status !== 'help') return null
  const note = ticket.blockedNote?.trim()
  return (
    <p className={className ?? 'dk-meta'} data-testid="ticket-blocked-note" data-status={ticket.status} data-content="learner">
      {ticket.status === 'blocked' ? 'Blocked' : 'Needs help'}{note ? `: ${note}` : null}
    </p>
  )
}

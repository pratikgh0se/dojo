import type { ReactNode } from 'react'
import type { Ticket } from '../../../data/types'
import { KIND_LABEL, LANE_LABEL, minutesLabel, tagLane } from '../../../rules/ticketMeta'

/** The header facts every kind shows (TICKET-01): lane tag, kind, estimate. `children` carries the XP chip. */
export function TicketFacts({ ticket, children }: { ticket: Ticket; children?: ReactNode }) {
  const lane = tagLane(ticket)
  return (
    <div className="dk-chips">
      <span className="dk-lane" data-lane={lane} data-testid="ticket-lane"><span>{LANE_LABEL[lane]}</span></span>
      <span className="dk-meta" data-testid="ticket-kind">{KIND_LABEL[ticket.kind]}</span>
      <span className="mono dk-meta" data-testid="ticket-est">{minutesLabel(ticket.estMin)}</span>
      {children}
    </div>
  )
}

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Ticket } from '../data/types'
import { rowMeta } from '../rules/board'
import { useTick } from './useTick'
import './ticketRow.css'

export function TickBox({
  ticket, label, testId, pressed = false,
}: { ticket: Ticket; label?: string; testId?: string; pressed?: boolean }) {
  const tick = useTick()
  const done = ticket.status === 'done'
  // pressed: a toggle button (aria-pressed), as the AI stage detail's session cubes need (C-PROJECTS §2.7).
  const semantics = pressed ? { 'aria-pressed': done } : { role: 'checkbox', 'aria-checked': done }
  return (
    <button
      type="button"
      {...semantics}
      aria-label={label ?? `Done: ${ticket.title}`}
      className={`tick${done ? ' on' : ''}`}
      data-testid={testId ?? `tick-${ticket.id}`}
      onClick={() => void tick(ticket)}
    >
      {done ? '✓' : ''}
    </button>
  )
}

export function TicketRow({ ticket, title, children }: { ticket: Ticket | null; title: ReactNode; children?: ReactNode }) {
  if (!ticket) {
    return (
      <div className="trow readonly" data-testid="row-readonly">
        <span className="tick-slot" aria-hidden="true" />
        <span className="trow-title">{title}</span>
        {children}
      </div>
    )
  }
  const done = ticket.status === 'done'
  return (
    <div className={`trow track-${ticket.track}${done ? ' done' : ''}`} data-testid={`row-${ticket.id}`}>
      <TickBox ticket={ticket} />
      <span className="trow-title">{title}</span>
      {children}
      <span className="trow-meta">{rowMeta(ticket)}</span>
      <Link to={`/do/${ticket.id}`} className="sr-btn sr-btn-quiet trow-do" aria-label={`Do: ${ticket.title}`} data-testid={`do-${ticket.id}`}>
        Do ▸
      </Link>
    </div>
  )
}

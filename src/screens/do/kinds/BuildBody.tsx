import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Ticket } from '../../../data/types'
import { appRoute } from '../../../lib/appLinks'
import { LEARNER_NOTES_MAX, type TicketWork } from '../../../study/useTicketWork'
import { shownText } from '../../../rules/ticketText'
import { Glyph } from '../../../ui/Glyph'
import { StatementText } from '../../../ui/StatementText'
import { ExplainSection } from './ExplainSection'
import { LabPanel } from './LabPanel'
import type { LabTicket } from './useLabTicket'

const GPU: Record<'none' | 'free' | 'rented', string> = { none: 'No GPU', free: 'Free GPU', rented: 'Rented GPU' }
const web = (u: string) => /^https?:\/\//i.test(u)

/** The ticket's links, one anchor each (1-based): a web page opens a new tab, a screen inside the app opens inside Dojo. */
function BuildLinks({ ticket }: { ticket: Ticket }) {
  const links = ticket.links.filter(l => web(l.url) || appRoute(l.url) !== null)
  if (links.length === 0) return null
  return (
    <ul className="dk-links" data-testid="ticket-links">
      {links.map((l, i) => {
        const route = web(l.url) ? null : appRoute(l.url)
        const inner = <><Glyph name="external" size={3} /><span className="dk-resmain"><b data-content="plan">{l.label}</b></span></>
        return (
          <li key={l.url}>
            {route !== null
              ? <Link className="dk-res wl" to={route} data-testid={`ticket-link-${i + 1}`}>{inner}</Link>
              : <a className="dk-res wl" href={l.url} target="_blank" rel="noopener noreferrer" data-testid={`ticket-link-${i + 1}`}>{inner}</a>}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A build ticket: its text, the GPU chip, links, explain questions, then the lab block (set up, checks, milestone, hints, review) or, for a
 * ticket with no lab, the honest self-mark. The Done gate itself lives in TicketView's actions.
 */
export function BuildBody({ ticket, work, readOnly, actions, lab }: { ticket: Ticket; work: TicketWork; readOnly: boolean; actions?: ReactNode; lab: LabTicket | null }) {
  const text = shownText(ticket.text)
  return (
    <>
      {text && <StatementText text={text} />}
      {ticket.lab && (
        <div className="dk-chips"><span className="dk-chip" data-testid="ticket-lab">{GPU[ticket.lab.gpu]}{ticket.lab.gpu === 'rented' && ticket.lab.costUsd !== undefined ? ` · $${ticket.lab.costUsd}` : ''}</span></div>
      )}
      <BuildLinks ticket={ticket} />
      <ExplainSection ticket={ticket} work={work} readOnly={readOnly} />
      {lab ? <LabPanel ticket={ticket} lab={lab} readOnly={readOnly} /> : (
        <label className="dk-self">
          <input type="checkbox" data-testid="ticket-selfmark" disabled={readOnly} checked={work.selfMark === 'done'} onChange={e => work.setSelfMark(e.target.checked ? 'done' : undefined)} />
          I ran the lab and looked at the result myself.
        </label>
      )}
      <section className="dk-box sr-panel">
        <label className="dk-cap" htmlFor={`notes-${ticket.id}`}>Notes while you work</label>
        <textarea id={`notes-${ticket.id}`} data-testid="ticket-notes" data-content="learner" disabled={readOnly} rows={5} maxLength={LEARNER_NOTES_MAX} value={work.notes} onChange={e => work.setNotes(e.target.value)} onBlur={() => void work.flush()} />
        {actions && <div className="dk-actions">{actions}</div>}
      </section>
    </>
  )
}

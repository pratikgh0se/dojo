import type { ReactNode } from 'react'
import type { Ticket } from '../../../data/types'
import { Link } from 'react-router-dom'
import { appRoute } from '../../../lib/appLinks'
import { LEARNER_NOTES_MAX, type TicketWork } from '../../../study/useTicketWork'
import { shownText } from '../../../rules/ticketText'
import { Glyph } from '../../../ui/Glyph'
import { StatementText } from '../../../ui/StatementText'
import { ExplainSection } from './ExplainSection'

const web = (u: string) => /^https?:\/\//i.test(u)
/** A plan link is a web page or a screen inside the app (`#bank` and the like); anything else is not shown. */
const usable = (u: string) => web(u) || appRoute(u) !== null
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '')

/** Watch, read and task: the resource, a notes box, and Explain it simply (answer first, never a gate). */
export function ResourceBody({ ticket, work, readOnly, actions }: { ticket: Ticket; work: TicketWork; readOnly: boolean; actions?: ReactNode }) {
  const links = ticket.links.filter(l => usable(l.url))
  const qs = ticket.explain ?? []
  const text = shownText(ticket.text)
  return (
    <>
      {text && <StatementText text={text} />}
      {links.map((l, i) => {
        const route = web(l.url) ? null : appRoute(l.url)
        const first = i === 0 ? { 'data-testid': 'ticket-link' } : {}
        const inner = (
          <>
            <Glyph name="external" size={3} />
            <span className="dk-resmain"><b>{i === 0 && route === null ? (ticket.kind === 'watch' ? 'Open the video' : 'Open the reading') : <span data-content="plan">{l.label}</span>}</b><span className="mono dk-meta" data-content="plan">{route ?? shortUrl(l.url)}</span></span>
          </>
        )
        // an in-app link opens that screen inside Dojo; a web link opens a new tab
        return route !== null
          ? <Link key={l.url} className="dk-res wl" to={route} {...first}>{inner}</Link>
          : <a key={l.url} className="dk-res wl" href={l.url} target="_blank" rel="noopener noreferrer" {...first}>{inner}</a>
      })}
      <section className="dk-box sr-panel">
        <label className="dk-cap" htmlFor={`notes-${ticket.id}`}>Notes while you work</label>
        <textarea id={`notes-${ticket.id}`} data-testid="ticket-notes" data-content="learner" disabled={readOnly} rows={5} maxLength={LEARNER_NOTES_MAX} value={work.notes} onChange={e => work.setNotes(e.target.value)} onBlur={() => void work.flush()} />
        {qs.length === 0 && actions && <div className="dk-actions">{actions}</div>}
      </section>
      <ExplainSection ticket={ticket} work={work} readOnly={readOnly} actions={actions} />
    </>
  )
}

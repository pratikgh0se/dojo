import type { ReactNode } from 'react'
import type { Ticket } from '../../../data/types'
import { Link } from 'react-router-dom'
import { appRoute } from '../../../lib/appLinks'
import { EXPLAIN_RESPONSE_MAX, LEARNER_NOTES_MAX, type TicketWork } from '../../../study/useTicketWork'
import { shownText } from '../../../rules/ticketText'
import { Glyph } from '../../../ui/Glyph'
import { StatementText } from '../../../ui/StatementText'
import { Button } from '../../../ui/primitives'

const web = (u: string) => /^https?:\/\//i.test(u)
/** A plan link is a web page or a screen inside the app (`#bank` and the like); anything else is not shown. */
const usable = (u: string) => web(u) || appRoute(u) !== null
const shortUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '')

/** Watch, read and task: the resource, a notes box, and Explain it simply (answer first, never a gate). */
export function ResourceBody({ ticket, work, readOnly, actions }: { ticket: Ticket; work: TicketWork; readOnly: boolean; actions?: ReactNode }) {
  const links = ticket.links.filter(l => usable(l.url))
  const qs = ticket.explain ?? []
  const text = shownText(ticket.text)
  const answered = qs.length > 0 && work.answers.every(a => a.trim() !== '')
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
      {qs.length > 0 && (
        <section className="dk-box sr-panel" data-testid="ticket-explain" aria-label="Explain it simply">
          <h2 className="dk-cap">Explain it simply</h2>
          {qs.map((q, i) => (
            <div key={i} className="dk-qa">
              <p className="dk-q" data-testid={`ticket-explain-q-${i + 1}`} data-content="plan"><span className="mono">Q{i + 1}</span> {q}</p>
              <textarea
                aria-label={`Answer to question ${i + 1}`} data-testid={`ticket-explain-answer-${i + 1}`} data-content="learner" disabled={readOnly} rows={3} maxLength={EXPLAIN_RESPONSE_MAX}
                value={work.answers[i] ?? ''} onChange={e => work.setAnswer(i, e.target.value)} onBlur={() => void work.flush()}
              />
              {work.revealed && (
                <div className="dk-ref">
                  <b>Reference</b>
                  <p data-testid={`ticket-reference-${i + 1}`} data-content="plan">{ticket.explainAnswers?.[i] ?? 'No reference answer is stored for this question.'}</p>
                </div>
              )}
            </div>
          ))}
          <div className="dk-actions">
            {!work.revealed && <Button data-testid="ticket-reveal" disabled={!answered} onClick={work.reveal}>Reveal reference answers</Button>}
            {actions}
          </div>
        </section>
      )}
    </>
  )
}

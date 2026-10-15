import { forwardRef, Fragment } from 'react'
import type { Ticket } from '../../data/types'
import { Glyph } from '../../ui/Glyph'
import { Pips } from '../../ui/Pips'
import { Button } from '../../ui/primitives'
import { KIND_GLYPH, KIND_LABEL, LANE_LABEL, minutesLabel, tagLane } from '../../rules/ticketMeta'
import type { QuestView } from '../../rules/todayModel'

const firstWebLink = (t: Ticket) => t.links.find(l => /^https?:\/\//i.test(l.url))
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }
const oneLine = (s: string) => { const x = s.replace(/\s+/g, ' ').trim().slice(0, 120); return x.charAt(0).toUpperCase() + x.slice(1) }

/** The one quest: a ticket (or a review), why, and the one orange button, with "Pick something else" to its left. */
export const QuestCard = forwardRef<HTMLButtonElement, {
  view: QuestView; action: string; count: number; readOnly: boolean; picking: boolean; onPick: () => void; onStart: () => void
  /** the quest ticket's skill topic, and how far through that topic's tickets the learner is (done, total, the quest's place) */
  topic?: { title: string; done: number; total: number; at: number } | null
}>(function QuestCard({ view, action, count, readOnly, picking, onPick, onStart, topic }, pickRef) {
  const t = view.ticket
  const link = t ? firstWebLink(t) : undefined
  const reason = oneLine(view.reason)
  // S2 words the empty queue and the phase note alike; the card says it once
  const noteDuplicatesReason = view.phaseNote !== null && view.tone === 'wait' && reason.toLowerCase().startsWith(view.phaseNote.toLowerCase())
  const notes = (
    <>
      {view.waits.length > 0 && (
        <p className="qc-note" data-testid="today-waits">
          {view.waits.map((w, i) => <Fragment key={w.id}>{i > 0 && ' '}&quot;<span data-content="plan">{w.title}</span>&quot; waits for a longer day.</Fragment>)}
        </p>
      )}
      {view.phaseNote && !noteDuplicatesReason && <p className="qc-note" data-testid="today-phase-note">{view.phaseNote}</p>}
    </>
  )
  return (
    <section
      className="qc sr-panel" data-testid="today-quest" data-action={action} aria-label="Your next ticket"
      data-ticket-id={t && (view.tone === 'start' || view.tone === 'resume') ? t.id : undefined}
    >
      <span className="qc-cap">Your next ticket</span>
      {t ? (
        <div className="qc-head">
          <div className="sr-tile qc-kind"><Glyph name={KIND_GLYPH[t.kind]} size={4} /></div>
          <div className="qc-main">
            <h2 className="qc-title" data-testid="today-title" data-content="plan">{t.title}</h2>
            <div className="qc-chips">
              <span className="qc-lane" data-lane={tagLane(t)}><span>{LANE_LABEL[tagLane(t)]}</span></span>
              <span className="qc-meta" data-testid="today-kind">{KIND_LABEL[t.kind]}</span>
              <span className="mono qc-meta" data-testid="today-est">{minutesLabel(t.estMin)}</span>
              {topic && <span className="qc-meta qc-topic" data-content="plan">{topic.title}</span>}
              {link && (
                <span data-testid="open-link" className="qc-linkwrap">
                  <a data-testid="today-link" data-content="plan" className="qc-link" href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`Open · ${host(link.url)}, ${link.label} (opens in a new tab)`}>
                    Open · {host(link.url)} <Glyph name="external" />
                  </a>
                </span>
              )}
            </div>
          </div>
        </div>
      ) : (
        <h2 className="qc-title" data-testid="today-title">{view.tone === 'review' ? `${count} ${count === 1 ? 'card is' : 'cards are'} due for review` : 'Nothing to start right now'}</h2>
      )}
      <p className="qc-reason" data-testid="today-reason">
        <Glyph name="flag" /> <span className="qc-rtext">{reason}</span>
        {topic && topic.total > 1 && topic.total <= 12 && <Pips className="qc-pips" count={topic.total} on={topic.done} cur={topic.at} label={`${topic.done} of ${topic.total} tickets done in ${topic.title}`} />}
      </p>
      {view.then && <div className="qc-then" data-testid="today-then"><span className="qc-cap">Then<span className="vh">:</span></span> <span className="qc-ttext">{view.then}</span></div>}
      <div className="qc-notes">{notes}</div>
      <div className="qc-actions">
        <Button ref={pickRef} variant="quiet" data-testid="today-pick-else" aria-expanded={picking} aria-controls={picking ? 'today-pick-list' : undefined} onClick={onPick}>Pick something else</Button>
        {view.button && (
          <Button variant="accent" data-accent="primary" data-testid="start-button" disabled={readOnly && view.tone !== 'review'} onClick={onStart}>{view.button}</Button>
        )}
      </div>
    </section>
  )
})

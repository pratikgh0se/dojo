import { useCheckAttempts } from '../../data/hooks'
import type { Brief, Ticket } from '../../data/types'
import { attemptScore } from '../../rules/check'
import { WithFileRefs } from '../../ui/FileRefs'
import { Panel } from '../../ui/primitives'
import { LINK_UNVERIFIED_HINT, linkVerdict } from './linkVerdict'
import './brief.css'

const DAY_LABEL = { focus: 'Focus day', light: 'Light day', long: 'Long day' } as const

function Steps({ brief }: { brief: Brief }) {
  const by = new Map((brief.linkCheck ?? []).map(l => [l.url, l]))
  return (
    <ol className="brief-steps">
      {brief.steps.map((s, i) => {
        const r = s.url ? by.get(s.url) : undefined
        return (
          <li key={i}>
            <WithFileRefs text={s.text} />
            {s.url && /^https?:\/\//i.test(s.url) && (
              <>
                {' '}
                <a href={s.url} target="_blank" rel="noopener noreferrer">{s.url}</a>
                {r && linkVerdict(r) === 'ok' && <span className="brief-link-ok" data-testid="link-ok">link ok</span>}
                {/* cu-4 P3-4: a 403 from a host that is up is not a broken link */}
                {r && linkVerdict(r) === 'unverified' && (
                  <span className="brief-link-unverified" data-testid="link-unverified" title={LINK_UNVERIFIED_HINT}>can&apos;t verify ({r.status})</span>
                )}
                {r && linkVerdict(r) === 'broken' && <span className="brief-link-broken" data-testid="link-broken">broken link{r.status ? ` (${r.status})` : ''}</span>}
              </>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * A stored card brief, read-only (TICKET-25): goal, steps with their link results, minutes, what you'll learn, the outcome, the
 * deliverable, what was handed in and the check attempts. R2 W7: the brief editor, the check and deliverable dialogs and the link checker
 * are gone, so there is no control to edit, approve or finish a card from here. Renders nothing until a brief exists.
 */
export function CardBrief({ ticket }: { ticket: Ticket }) {
  const attempts = useCheckAttempts(ticket.id)
  const b = ticket.brief
  if (!b) return null
  return (
    <Panel className="brief" data-testid="card-brief" aria-label="Card brief">
      {/* D3.2 / M8: the status and source chips sit in the h2 row's right slot */}
      <div className="brief-head">
        <h2 className="sr-panel-title">Brief</h2>
        <span className="brief-chips">
          <span className="brief-chip" data-status={b.status} data-testid="brief-status">{b.status === 'approved' ? 'Approved' : 'Draft'}</span>
          <span className="brief-chip">{b.source === 'edited' ? 'Edited by you' : 'AI draft'}</span>
        </span>
      </div>
      <p className="brief-goal" data-testid="brief-goal"><WithFileRefs text={b.goal} /></p>
      <h3 className="brief-sub">Steps</h3>
      <Steps brief={b} />
      <p className="brief-meta">{b.minutes} min · {DAY_LABEL[b.dayType]}</p>
      {b.learn.length > 0 && (
        <>
          <h3 className="brief-sub">What you&apos;ll learn</h3>
          <ul className="brief-list">{b.learn.map((l, i) => <li key={i}><WithFileRefs text={l} /></li>)}</ul>
        </>
      )}
      <h3 className="brief-sub">Outcome</h3>
      <p className="brief-text"><WithFileRefs text={b.outcome} /></p>
      <h3 className="brief-sub">Deliverable</h3>
      <p className="brief-text" data-testid="brief-deliverable"><WithFileRefs text={b.deliverable.prompt} /></p>
      {ticket.deliverable && (
        <>
          <h3 className="brief-sub">Handed in</h3>
          <p className="brief-text" data-testid="deliverable-text">{ticket.deliverable.text}</p>
          {ticket.deliverable.feedback?.map((f, i) => <p key={i} className="brief-note">{f}</p>)}
        </>
      )}
      {attempts && attempts.length > 0 && (
        <>
          <h3 className="brief-sub">Check attempts</h3>
          <ul className="brief-attempts" data-testid="check-attempts">
            {attempts.map((a, i) => (
              <li key={a.id} className="brief-attempt" data-testid="check-attempt">
                Attempt {i + 1} · {attemptScore(a.feedback)}
                <dl>
                  {b.questions.map(q => {
                    const ans = a.answers.find(x => x.id === q.id)
                    const fb = a.feedback.find(x => x.id === q.id)
                    return (
                      <div key={q.id}>
                        <dt>{q.q}</dt>
                        <dd>
                          {q.kind === 'mcq' ? (ans?.choice !== undefined ? q.choices?.[ans.choice] : '') : ans?.answer}
                          {fb?.correction ? ` — ${fb.correction}${fb.pointer ? ` (${fb.pointer})` : ''}` : ''}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

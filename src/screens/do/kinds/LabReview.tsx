import { useState } from 'react'
import { useDb } from '../../../app/providers'
import { requestReview } from '../../../data/labActions'
import { now } from '../../../lib/clock'
import { latestReview } from '../../../rules/lab'
import { weakItems } from '../../../rules/labReview'
import { labErrorText } from '../../../rules/labView'
import { learnerWords } from '../../../rules/learnerWords'
import { Button } from '../../../ui/primitives'
import '../lab.css'
import type { LabTicket } from './useLabTicket'

/** Failures that are about the lab folder or the milestones: the request button stays. Anything else (an unusable or failed AI reply) gets Retry. */
const LAB_SIDE = new Set(['lab_dirty', 'not_set_up', 'not_ready', 'bad_root', 'unknown_lab', 'busy', 'no_server', 'not_writer', 'make_missing'])

/**
 * The AI review of the lab, inside the lab block of EVERY ticket of the lab (ruling R-1). It is enabled when every milestone is passed, whichever
 * ticket is open and whether or not any ticket is done. The newest stored review is what shows; "Not yet" is never a failure.
 */
export function LabReview({ lab, readOnly, onLost }: { lab: LabTicket; readOnly: boolean; onLost: () => void }) {
  const d = useDb()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; text: string } | null>(null)
  const latest = latestReview(lab.reviews)
  const rubric = lab.info?.rubric ?? []
  const weak = latest ? weakItems(latest.items) : []
  const text = (id: string) => rubric.find(r => r.id === id)?.text ?? id
  const locked = !!lab.info && !lab.allPassed

  async function request() {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const r = await requestReview(d, lab.labId, now())
      if (!r.ok) {
        setError({ code: r.code, text: learnerWords(labErrorText(r.code, r.message)) })
        if (r.code === 'not_set_up') onLost()
      }
    } catch { setError({ code: 'invalid_output', text: labErrorText('invalid_output') }) } finally { setBusy(false) }
  }

  return (
    <section className="dk-lab-sub" data-testid="ticket-reviewer" data-lab-id={lab.labId} data-running={busy ? 'true' : undefined} aria-label="Lab review">
      <div className="dk-trow">
        <h3 className="dk-cap">AI review</h3>
        {latest && <span className="dk-chip dk-rv-badge" data-testid="ticket-review-badge" data-state={latest.passed ? 'proven' : 'notyet'}>{latest.passed ? 'Proven' : 'Not yet'}</span>}
      </div>
      {!latest && <p className="dk-meta">An AI review reads your committed lab work and scores it against the rubric. 70% or more makes the lab Proven.</p>}
      {latest && (
        <>
          <p><span className="dk-rv-percent" data-testid="ticket-review-percent">{latest.percent}%</span></p>
          <p className="dk-meta" data-testid="ticket-review-summary">{learnerWords(latest.summary)}</p>
          <ol className="dk-rv-items" data-testid="ticket-review-items">
            {latest.items.map(it => (
              <li key={it.id} className="dk-rv-item" data-testid={`ticket-review-item-${it.id}`} data-score={it.score}>
                <p className="dk-q" data-testid={`ticket-review-item-text-${it.id}`} data-content="plan">{text(it.id)}</p>
                <span className="mono dk-meta" data-testid={`ticket-review-score-${it.id}`}>{it.score} of 3</span>
                {it.evidence.map((e, i) => (
                  <p key={i} data-testid={`ticket-review-evidence-${it.id}-${i + 1}`}><code data-content="learner">{e.file}:{e.line}</code> <q data-content="learner">{e.quote}</q></p>
                ))}
                {it.stronger && <p data-testid={`ticket-review-stronger-${it.id}`}><b>What a stronger version does</b> {learnerWords(it.stronger)}</p>}
              </li>
            ))}
          </ol>
          {weak.length > 0 && (
            <div data-testid="ticket-review-weak">
              <h4 className="dk-cap">To work on</h4>
              <ul className="dk-rv-weak">{weak.map(it => <li key={it.id} data-testid={`ticket-review-weak-${it.id}`} data-content="plan">{text(it.id)}</li>)}</ul>
            </div>
          )}
        </>
      )}
      {busy && <p className="dk-meta" role="status" data-testid="ticket-review-running">Reviewing your lab. This can take up to a minute and a half.</p>}
      {error && <p className="dk-lab-error" role="alert" data-testid="ticket-review-error">{error.text}</p>}
      {locked && <p className="dk-meta" data-testid="ticket-review-note">Available once every milestone is passed.</p>}
      <div className="dk-lab-row">
        {error && !LAB_SIDE.has(error.code)
          ? <Button data-testid="ticket-review-retry" disabled={readOnly || busy} onClick={() => void request()}>Retry</Button>
          : <Button data-testid="ticket-review-request" disabled={readOnly || busy || !lab.allPassed} onClick={() => void request()}>Request review</Button>}
      </div>
    </section>
  )
}

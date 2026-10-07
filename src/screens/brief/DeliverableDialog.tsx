import { useState } from 'react'
import { useDb } from '../../app/providers'
import { deliverableFeedback, submitDeliverable } from '../../data/checkActions'
import { safeWrite } from '../../data/safeWrite'
import type { Brief, Ticket } from '../../data/types'
import { now } from '../../lib/clock'
import { AiError, AiLoader, type AiFailure } from '../../ui/ai/AiStates'
import { deliverableOf } from '../../rules/brief'
import { Button, useToast } from '../../ui/primitives'
import { Dialog } from '../ai/Dialog'
import './brief.css'

/** "Deliverable" (Addendum 1 Q7): the prompt, one textbox and Save. "Get feedback" is optional and never writes code. */
export function DeliverableDialog({ ticket, brief, onClose, onDone, returnFocus }: {
  ticket: Ticket; brief: Brief; onClose: () => void; onDone: (xp: number) => void; returnFocus: () => HTMLElement | null
}) {
  const d = useDb()
  const toast = useToast()
  const [text, setText] = useState(ticket.deliverable?.text ?? '')
  const [feedback, setFeedback] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<AiFailure | null>(null)
  const [error, setError] = useState<string | null>(null)
  // UAT cu-5 P2-2: a teach-back hands in an explanation: its prompt and its box say so, and its feedback is graded as prose
  const asked = deliverableOf(ticket, brief) ?? brief.deliverable
  const explanation = asked.kind === 'explanation'

  async function save() {
    setError(null)
    const r = await safeWrite(() => submitDeliverable(d, ticket.id, text, now(), feedback ?? undefined), m => toast(m, 'danger'))
    if (!r) return
    if (!r.ok) return setError(r.error)
    onDone(r.xpDelta)
    onClose()
  }

  async function ask() {
    if (!text.trim()) return setError('Hand something in first')
    setError(null)
    setFailure(null)
    setBusy(true)
    try {
      const r = await deliverableFeedback(d, ticket.id, text, now())
      if (r.ok) setFeedback(r.feedback)
      else setFailure({ code: r.code, message: r.error })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog title="Deliverable" testId="deliverable-dialog" onClose={onClose} returnFocus={returnFocus}>
      <div className="p-form">
        {/* shell-today-board M26: the prompt paragraph names the textarea; no extra visible label */}
        <p className="brief-text" id="dv-prompt">{asked.prompt}</p>
        <div className="p-field">
          <textarea id="dv-text" aria-labelledby="dv-prompt" placeholder={explanation ? 'Write it in your own words, or describe your sketch' : 'Text, code as text, a link or a path'} value={text} onChange={e => { setText(e.target.value); setError(null) }} />
        </div>
        {busy && <AiLoader />}
        {failure && <AiError failure={failure} onRetry={() => void ask()} />}
        {feedback && <ul className="brief-list" data-testid="deliverable-feedback">{feedback.map((f, i) => <li key={i}>{f}</li>)}</ul>}
        {/* UAT cu-2p P3-5: the line keeps its place whether or not it has words, so Save and Get feedback never move when it
            appears; typing clears it */}
        <p className="p-err p-err-slot" role="alert" data-testid="deliverable-error">{error}</p>
        <div className="p-actions">
          <Button variant="accent" onClick={() => void save()}>Save</Button>
          <Button disabled={busy} onClick={() => void ask()}>{busy ? 'Getting feedback…' : 'Get feedback'}</Button>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  )
}

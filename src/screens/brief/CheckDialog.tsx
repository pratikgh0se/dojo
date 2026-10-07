import { useState } from 'react'
import type { CheckResult } from '../../ai/types'
import { useDb } from '../../app/providers'
import { submitCheck } from '../../data/checkActions'
import { safeWrite } from '../../data/safeWrite'
import { isReadOnly, READ_ONLY_MESSAGE } from '../../data/writer'
import type { Brief, Ticket } from '../../data/types'
import { now } from '../../lib/clock'
import { closeStudyOnCheckPass } from '../../study/runner'
import { unanswered, type CheckAnswer } from '../../rules/check'
import { AiError, AiLoader, type AiFailure } from '../../ui/ai/AiStates'
import { Button, useToast } from '../../ui/primitives'
import { Dialog } from '../ai/Dialog'
import { BriefEditor } from './BriefEditor'
import './brief.css'

/** "Check your understanding" (Addendum 1 Q5): the brief's questions, graded by the `check` job. */
export function CheckDialog({ ticket, brief, onClose, onDone, returnFocus }: {
  ticket: Ticket; brief: Brief; onClose: () => void; onDone: (xp: number) => void; returnFocus: () => HTMLElement | null
}) {
  const d = useDb()
  const toast = useToast()
  const [answers, setAnswers] = useState<CheckAnswer[]>([])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [failure, setFailure] = useState<AiFailure | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [result, setResult] = useState<{ passed: boolean; results: CheckResult[] } | null>(null)
  // UAT cu-5 P3-7: the questions whose answer was changed since the last check; their correction is the old one
  const [edited, setEdited] = useState<ReadonlySet<string>>(new Set())
  const put = (id: string, patch: Partial<CheckAnswer>) => {
    setEdited(s => (s.has(id) ? s : new Set(s).add(id)))
    // UAT cu-2 P3-10: "Answer every question first" is about what was missing; it goes as soon as an answer changes
    setMessage(null)
    setAnswers(a => (a.some(x => x.id === id) ? a.map(x => (x.id === id ? { ...x, ...patch } : x)) : [...a, { id, ...patch }]))
  }
  const locked = result?.passed === true
  const missing = unanswered(brief.questions, answers).length

  async function check() {
    if (busy || locked) return
    if (isReadOnly()) return void toast(READ_ONLY_MESSAGE, 'danger')
    if (missing > 0) return setMessage('Answer every question first')
    setMessage(null)
    setFailure(null)
    setBusy(true)
    try {
      const at = now()
      const r = await safeWrite(() => submitCheck(d, ticket.id, answers, at), m => toast(m, 'danger'))
      if (!r) return
      if (!r.ok) {
        if (r.code === 'incomplete' || r.code === 'no_brief') setMessage(r.error)
        else setFailure({ code: r.code, message: r.error })
        return
      }
      setResult({ passed: r.passed, results: r.results })
      setEdited(new Set())
      if (!r.passed) return
      // Addendum 6: a pass ends a study session running on this card, as Solved would
      await closeStudyOnCheckPass({ d, ticketId: ticket.id, nowMs: at, xpDelta: r.xpDelta, chime: () => {}, toast, onError: m => toast(m, 'danger') })
      onDone(r.xpDelta)
    } finally {
      setBusy(false)
    }
  }

  if (editing) return <BriefEditor ticket={ticket} brief={brief} onClose={onClose} returnFocus={returnFocus} />
  return (
    <Dialog title="Check your understanding" testId="check-dialog" onClose={onClose} returnFocus={returnFocus}>
      <div className="p-form">
        {brief.questions.length === 0 && (
          <>
            <p className="brief-text" data-testid="check-no-questions">This brief has no questions yet — Edit brief to add one.</p>
          </>
        )}
        {brief.questions.map(q => {
          const fb = result?.results.find(r => r.id === q.id)
          return (
            <div className="bf-question ck-question" key={q.id}>
              {q.kind === 'open' ? (
                <div className="p-field">
                  <label htmlFor={`ck-${q.id}`}>{q.q}</label>
                  <textarea id={`ck-${q.id}`} disabled={locked} value={answers.find(a => a.id === q.id)?.answer ?? ''} onChange={e => put(q.id, { answer: e.target.value })} />
                </div>
              ) : (
                <fieldset className="bf-radio-group" role="radiogroup" aria-label={q.q}>
                  <legend aria-hidden="true">{q.q}</legend>
                  {(q.choices ?? []).map((c, i) => (
                    <label className="sr-choice" key={i}>
                      <input type="radio" name={`ck-${q.id}`} disabled={locked} checked={answers.find(a => a.id === q.id)?.choice === i} onChange={() => put(q.id, { choice: i })} />
                      {c}
                    </label>
                  ))}
                </fieldset>
              )}
              {fb && fb.verdict !== 'pass' && (
                // an answer changed since this was said is no longer what it was said about: it reads as the earlier note, not a verdict
                <p className="bf-fix" data-testid="check-correction" data-stale={edited.has(q.id) ? 'true' : undefined}>
                  {edited.has(q.id) && <span className="bf-fix-was">Earlier: </span>}{fb.correction}{fb.pointer ? ` (${fb.pointer})` : ''}
                </p>
              )}
            </div>
          )
        })}
        {busy && <AiLoader />}
        {failure && <AiError failure={failure} onRetry={() => void check()} />}
        {message && <p className="p-err" role="alert">{message}</p>}
        {result && (
          <p className="bf-verdict" role="status" data-passed={result.passed ? 'true' : 'false'} data-testid="check-verdict">
            {result.passed ? 'Passed' : 'Not yet'}
          </p>
        )}
        {result && !result.passed && <p className="p-note">A redo is scheduled in 3 days. Fix the answers above to try again now.</p>}
        {/* M25: one actions row (flex, gap 8, wrap); with no questions it holds Edit brief and Cancel */}
        <div className="p-actions">
          {brief.questions.length === 0 && <Button variant="accent" onClick={() => setEditing(true)}>Edit brief</Button>}
          {!locked && brief.questions.length > 0 && <Button variant="accent" disabled={busy} onClick={() => void check()}>{busy ? 'Checking…' : 'Check answers'}</Button>}
          <Button variant="quiet" onClick={onClose}>{locked ? 'Close' : 'Cancel'}</Button>
        </div>
      </div>
    </Dialog>
  )
}

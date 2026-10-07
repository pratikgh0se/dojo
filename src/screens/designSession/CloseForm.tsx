import { useCallback, useState } from 'react'
import { useDb } from '../../app/providers'
import { enterScore, saveClose } from '../../data/designSessionActions'
import { safeWrite } from '../../data/safeWrite'
import { CLOSE_QUESTIONS } from '../../content/tracking'
import type { CloseAnswers, DesignSession, Tradeoff } from '../../data/types'
import type { PlanDesignRef } from '../../rules/designs'
import { closeComplete, EMPTY_CLOSE, NONE_OPTION } from '../../rules/designSession'
import { Button, useToast } from '../../ui/primitives'

export function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="ds-field">
      <span>{label}</span>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} />
    </label>
  )
}

const fromSession = (c: CloseAnswers | undefined): CloseAnswers => ({
  ...EMPTY_CLOSE, ...c, tradeoff: { ...EMPTY_CLOSE.tradeoff, ...c?.tradeoff },
})

/** TRACKING §1 "The 5-question close": fixed questions, all required, saved as typed.
 * `push`/`flush` come from the parent's write queue (shared with the canvas and Score form) so the
 * pagehide/visibilitychange/unmount flush registered once at the top level (D-23, extended to
 * Close/Score) also covers a Close answer typed just before the tab closes. */
export function CloseForm({
  item, session, push, flush,
}: { item: PlanDesignRef; session: DesignSession; push: (job: () => Promise<unknown>) => void; flush: () => Promise<void> }) {
  const d = useDb()
  const toast = useToast()
  const onError = useCallback((m: string) => toast(m, 'danger'), [toast])
  const [c, setC] = useState(() => fromSession(session.close))
  const update = (next: CloseAnswers) => {
    setC(next)
    push(() => saveClose(d, session.id, next))
  }
  const setTrade = (k: keyof Tradeoff, v: string) => update({ ...c, tradeoff: { ...c.tradeoff, [k]: v } })
  const [q1, q2, q3, q4, q5] = CLOSE_QUESTIONS
  const next = async () => {
    await flush()
    await safeWrite(() => enterScore(d, session.id, c), onError)
  }
  const radio = `q4-${session.id}`
  return (
    <form className="sr-panel ds-close" data-testid="session-close" aria-label="Five-question close" noValidate onSubmit={e => e.preventDefault()}>
      <h2 className="sr-panel-title">Five-question close</h2>
      <fieldset className="ds-q">
        <legend>{q1}</legend>
        <div className="ds-trade">
          <TextField label="Chose" value={c.tradeoff.chose} onChange={v => setTrade('chose', v)} />
          <TextField label="Over" value={c.tradeoff.over} onChange={v => setTrade('over', v)} />
          <TextField label="Because" value={c.tradeoff.because} onChange={v => setTrade('because', v)} />
        </div>
      </fieldset>
      <fieldset className="ds-q">
        <legend>{q2}</legend>
        <textarea aria-label={q2} rows={2} value={c.breaksAt10x} onChange={e => update({ ...c, breaksAt10x: e.target.value })} />
      </fieldset>
      <fieldset className="ds-q">
        <legend>{q3}</legend>
        <textarea aria-label={q3} rows={2} value={c.dataOwnership} onChange={e => update({ ...c, dataOwnership: e.target.value })} />
      </fieldset>
      <fieldset className="ds-q">
        <legend>{q4}</legend>
        <div role="radiogroup" aria-label={q4} className="ds-q4">
          {item.deepDives.map((q, i) => (
            <label key={i} className="sr-choice">
              <input type="radio" name={radio} checked={c.couldNotAnswer === i} onChange={() => update({ ...c, couldNotAnswer: i as 0 | 1 | 2 | 3 })} />
              {q}
            </label>
          ))}
          <label className="sr-choice">
            <input type="radio" name={radio} checked={c.couldNotAnswer === 'none'} onChange={() => update({ ...c, couldNotAnswer: 'none' })} />
            {NONE_OPTION}
          </label>
        </div>
      </fieldset>
      <fieldset className="ds-q">
        <legend>{q5}</legend>
        <input type="text" aria-label={q5} value={c.readNext} onChange={e => update({ ...c, readNext: e.target.value })} />
      </fieldset>
      <Button variant="accent" disabled={!closeComplete(c)} onClick={() => void next()}>Next: score</Button>
    </form>
  )
}

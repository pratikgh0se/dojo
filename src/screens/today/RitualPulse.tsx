import { useState, type FormEvent } from 'react'
import { useDb } from '../../app/providers'
import { logPulse } from '../../data/ritualActions'
import { usePulse } from '../../data/hooks'
import { safeWrite } from '../../data/safeWrite'
import { localDayKey } from '../../lib/dates'
import { checkPulseText, PULSE_MAX, pulseWhen } from '../../rules/ritual'
import { Glyph } from '../../ui/Glyph'
import { Button, useToast } from '../../ui/primitives'
import './ritual.css'

/**
 * The daily AI pulse: one line about what the learner asked an AI tool today, kept as one row per local day.
 * It is a log, not a ticket: no XP, no streak, no skip. A day without a line simply shows the field again the next day.
 */
export function RitualPulse({ nowMs, readOnly }: { nowMs: number; readOnly: boolean }) {
  const d = useDb()
  const toast = useToast()
  const day = localDayKey(nowMs)
  const row = usePulse(day)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  if (row === undefined) return null // loading: nothing is drawn, so a logged day never flashes the empty field
  const logged = row !== null
  const showField = !logged || editing
  const blank = checkPulseText(draft).ok === false

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (blank || readOnly) return
    const r = await safeWrite(() => logPulse(d, draft, nowMs), m => toast(m, 'danger'))
    if (!r) return
    if (!r.ok) { toast(r.message, 'danger'); return }
    setEditing(false)
    setDraft('')
  }
  const edit = () => { setDraft(row?.text ?? ''); setEditing(true) }

  return (
    <section className="rt-card sr-panel" data-testid="today-pulse" data-state={logged ? 'logged' : 'open'} aria-label="Daily AI pulse">
      <div className="rt-row">
        <span className="qc-cap rt-grow">Daily AI pulse · 15 min</span>
        {logged && <span className="qc-cap rt-ok" data-testid="today-pulse-done">Done</span>}
      </div>
      {showField ? (
        <form className="rt-form" onSubmit={save}>
          <label className="rt-label" htmlFor="today-pulse-input">What did you ask an AI tool today?</label>
          <div className="rt-field">
            <input
              id="today-pulse-input" data-testid="today-pulse-input" type="text" autoComplete="off" maxLength={PULSE_MAX}
              placeholder="Asked an AI about attention" value={draft} disabled={readOnly}
              onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Escape' && editing) { setEditing(false); setDraft('') } }}
            />
            <Button type="submit" variant="quiet" data-testid="today-pulse-log" disabled={blank || readOnly}>Log</Button>
          </div>
        </form>
      ) : (
        <div className="rt-body">
          <div className="rt-tick"><Glyph name="check" size={3} /></div>
          <div className="rt-grow">
            <div className="rt-text" data-testid="today-pulse-text">{row.text}</div>
            <div className="qc-meta rt-when" data-testid="today-pulse-when">{pulseWhen(row.at)}</div>
          </div>
          <Button variant="quiet" data-testid="today-pulse-edit" disabled={readOnly} onClick={edit}>Edit</Button>
        </div>
      )}
    </section>
  )
}

import { useState, type FormEvent } from 'react'
import { useDb } from '../app/providers'
import { saveStartDate, START_DATE_PICK_ERROR } from '../data/settingsActions'
import { isIsoDate } from '../lib/dates'
import { now } from '../lib/clock'
import { READ_ONLY_MESSAGE } from '../data/writer'
import { defaultStartDate, startDateNote, startDateWarning } from '../rules/onboarding'
import { Button, useToast } from '../ui/primitives'

export function Onboarding() {
  const d = useDb()
  const toast = useToast()
  const [value, setValue] = useState(() => defaultStartDate(now()))
  const [error, setError] = useState<string | null>(null)
  // ruling 21: a non-Monday start gets a warn note, live as the date changes; it never blocks Start the plan
  const warning = startDateWarning(value)
  // ruling 22 D3: the Tue/Wed default is the Monday just gone, and says why
  const note = startDateNote(value, now())
  const describedBy = [note && 'onboarding-note', warning && 'onboarding-warn', error && 'onboarding-error'].filter(Boolean).join(' ') || undefined

  /** P3-2: the error is about the date that was there; a valid pick clears it (and its red border) at once. */
  function pick(v: string) {
    setValue(v)
    if (isIsoDate(v)) setError(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    // Addendum 7: a read-only refusal is the "Read-only" toast, like every other refused change.
    const ok = await saveStartDate(d, value, m => (m === READ_ONLY_MESSAGE ? toast(m, 'danger') : setError(m)), START_DATE_PICK_ERROR)
    if (ok) {
      setError(null)
      toast(`Start date set to ${value}`)
    }
  }

  return (
    <main className="onboarding" data-testid="screen-onboarding" data-ready="true">
      <form className="sr-hero onboarding-card" onSubmit={submit} noValidate>
        <p className="eyebrow">Dojo · first launch</p>
        <h1 className="screen-title">Pick your start date</h1>
        <p>Sprint 1 of 72 begins on this date at local midnight. Each sprint is 14 days. You can change it later in Settings.</p>
        <label>
          Start date
          <input type="date" value={value} aria-invalid={error ? true : undefined} aria-describedby={describedBy} onChange={e => pick(e.target.value)} />
        </label>
        {note && <p className="form-note" id="onboarding-note" data-testid="start-date-note">{note}</p>}
        {warning && <p className="form-warn" id="onboarding-warn" data-testid="start-date-warn">{warning}</p>}
        {error && <p role="alert" className="form-error" id="onboarding-error" data-testid="form-error">{error}</p>}
        <Button type="submit" variant="accent" className="sr-btn-lg">Start the plan ▸</Button>
      </form>
    </main>
  )
}

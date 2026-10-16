import { useId, useState } from 'react'
import { useDb } from '../../app/providers'
import { usePulse } from '../../data/hooks'
import { saveJournal } from '../../data/journalActions'
import { safeWrite } from '../../data/safeWrite'
import type { JournalExplain, JournalObstacle, JournalRating, JournalRow, Ticket } from '../../data/types'
import { isReadOnly } from '../../data/writer'
import { now } from '../../lib/clock'
import {
  canSave, EXPLAINS, formFromRow, isSaved, JOURNAL_LINE_MAX, JOURNAL_TEXT_MAX, listedFor, longWeekday, OBSTACLES, RATINGS, toggle,
  type JournalForm,
} from '../../rules/journal'
import { Button, useToast } from '../../ui/primitives'

type Opt<T extends string> = readonly { id: T; label: string }[]

/** A row of toggle buttons: the pressed one has aria-pressed, pressing it again clears it. None is an accent. */
function Segmented<T extends string>({ testId, labelId, extraId, label, options, value, disabled, onPick }: {
  testId: string; labelId: string; extraId?: string; label: string; options: Opt<T>; value: T | null; disabled: boolean; onPick: (v: T | null) => void
}) {
  return (
    <div className="jr-choice">
      <span className="jr-choice-label" id={labelId}>{label}</span>
      <div className="jr-seg" data-n={options.length} role="group" aria-labelledby={extraId ? `${labelId} ${extraId}` : labelId} data-testid={testId}>
        {options.map(o => (
          <Button
            key={o.id} variant="quiet" className="jr-opt" data-testid={`${testId}-${o.id}`} aria-pressed={value === o.id} disabled={disabled}
            onClick={() => onPick(toggle(value, o.id))}
          >
            {o.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/** The entry for one day (JOURNAL-01 to JOURNAL-14). Its form is local state; only Save writes. */
export function Entry({ day, today, tickets, stored, onPick }: {
  day: string; today: string; tickets: readonly Ticket[]; stored: JournalRow | null; onPick: (day: string) => void
}) {
  const d = useDb()
  const toast = useToast()
  const readOnly = isReadOnly()
  const uid = useId()
  const pulse = usePulse(day)
  const [form, setForm] = useState<JournalForm>(() => formFromRow(stored))
  const [saving, setSaving] = useState(false)
  const listed = listedFor(tickets, day)
  const ids = listed.map(t => t.id)
  const saved = isSaved(form, stored, ids)
  const none = form.mode === 'none'
  const set = (patch: Partial<JournalForm>) => setForm(f => ({ ...f, ...patch }))
  const setPick = (id: string, patch: Partial<{ rating: JournalRating | null; explain: JournalExplain | null }>) =>
    setForm(f => ({ ...f, picks: { ...f.picks, [id]: { ...(f.picks[id] ?? { rating: null, explain: null }), ...patch } } }))
  const text = (key: 'hardest' | 'next' | 'notes') => (e: { target: { value: string } }) => set({ [key]: e.target.value.slice(0, JOURNAL_TEXT_MAX) })
  const enabled = canSave(form, ids) && !saved && !readOnly && !saving

  // a Floor day was a study day: the "No study today" button must not sit right under the Floor line, so it moves below the fields (UAT A J7.5)
  const floorShown = stored?.floor === true && !!stored.line && !none
  const modeToggle = (
    <div className="jr-mode">
      <Button variant="quiet" data-testid="journal-mode-none" aria-pressed={none} disabled={readOnly} onClick={() => set({ mode: none ? 'studied' : 'none' })}>No study today</Button>
    </div>
  )

  async function save() {
    if (!enabled) return
    setSaving(true)
    try {
      await safeWrite(() => saveJournal(d, form, day, ids, now()), m => toast(m, 'danger'))
    } catch {
      toast('That entry was not saved. Try again.', 'danger')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="jr-entry jr-panel sr-panel" aria-labelledby={`${uid}-heading`}>
      <div className="jr-head">
        <h2 className="jr-day" id={`${uid}-heading`} data-testid="journal-day-heading">{longWeekday(day)} {day}</h2>
        <label className="jr-date">
          <span>Day</span>
          <input
            type="date" data-testid="journal-date" value={day} max={today}
            onChange={e => { const v = e.target.value; if (v && v <= today) onPick(v) }}
          />
        </label>
      </div>

      {pulse && (
        <section className="jr-pulse" data-testid="journal-pulse" aria-label="Daily AI pulse">
          <span className="jr-cap">Daily AI pulse</span>
          <p className="jr-pulse-text" data-testid="journal-pulse-text" data-content="learner">{pulse.text}</p>
        </section>
      )}

      {/* W5 (JOURNAL-30): the day's Floor line, read-only; present only on a day whose stored row came from a Floor session */}
      {floorShown && (
        <section className="jr-pulse" data-testid="journal-floor" aria-label="Floor session">
          <span className="jr-cap">Floor session</span>
          <p className="jr-pulse-text" data-testid="journal-floor-text" data-content="learner">{stored.line}</p>
        </section>
      )}

      {!floorShown && modeToggle}

      {none ? (
        <div className="jr-none">
          <Segmented<JournalObstacle>
            testId="journal-obstacle" labelId={`${uid}-obstacle`} label="What got in the way?" options={OBSTACLES} value={form.obstacle}
            disabled={readOnly} onPick={v => set({ obstacle: v })}
          />
          <label className="jr-field">
            <span>What did you want to do?</span>
            <input
              type="text" data-testid="journal-line" data-content="learner" autoComplete="off" maxLength={JOURNAL_LINE_MAX} value={form.line} disabled={readOnly}
              onChange={e => set({ line: e.target.value.slice(0, JOURNAL_LINE_MAX) })}
            />
          </label>
        </div>
      ) : (
        <>
          <div className="jr-items" data-testid="journal-items">
            {listed.length === 0 ? (
              <p className="jr-empty" data-testid="journal-items-empty" data-empty="true">No tickets finished this day.</p>
            ) : (
              <ul className="jr-list">
                {listed.map(t => {
                  const p = form.picks[t.id] ?? { rating: null, explain: null }
                  return (
                    <li key={t.id} className="jr-item" data-testid={`journal-item-${t.id}`} data-ticket-id={t.id}>
                      <div className="jr-item-head">
                        <span className="jr-item-title" id={`${uid}-t-${t.id}`} data-content="plan" data-testid={`journal-item-title-${t.id}`}>{t.title}</span>
                        <span className="jr-meta" data-testid={`journal-item-est-${t.id}`}>{t.estMin} min</span>
                      </div>
                      <Segmented<JournalRating>
                        testId={`journal-rating-${t.id}`} labelId={`${uid}-r-${t.id}`} extraId={`${uid}-t-${t.id}`} label="How hard?" options={RATINGS}
                        value={p.rating} disabled={readOnly} onPick={v => setPick(t.id, { rating: v })}
                      />
                      <Segmented<JournalExplain>
                        testId={`journal-explain-${t.id}`} labelId={`${uid}-e-${t.id}`} extraId={`${uid}-t-${t.id}`} label="Could you explain it without notes?" options={EXPLAINS}
                        value={p.explain} disabled={readOnly} onPick={v => setPick(t.id, { explain: v })}
                      />
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <label className="jr-field">
            <span>Hardest point and why</span>
            <textarea data-testid="journal-hardest" data-content="learner" maxLength={JOURNAL_TEXT_MAX} rows={3} value={form.hardest} disabled={readOnly} onChange={text('hardest')} />
          </label>
          <label className="jr-field">
            <span>Next step</span>
            <textarea data-testid="journal-next" data-content="learner" maxLength={JOURNAL_TEXT_MAX} rows={3} value={form.next} disabled={readOnly} onChange={text('next')} />
          </label>
          <label className="jr-field">
            <span>Notes</span>
            <textarea data-testid="journal-notes" data-content="learner" maxLength={JOURNAL_TEXT_MAX} rows={3} value={form.notes} disabled={readOnly} onChange={text('notes')} />
          </label>
          {floorShown && modeToggle}
        </>
      )}

      <div className="jr-save">
        {saved && <span className="jr-saved" data-testid="journal-saved" role="status">Saved</span>}
        <Button variant="accent" data-accent="primary" data-testid="journal-save" disabled={!enabled} onClick={() => void save()}>SAVE · ENTRY</Button>
      </div>
    </section>
  )
}

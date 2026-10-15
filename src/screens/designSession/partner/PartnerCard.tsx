import { useMemo, useRef, useState } from 'react'
import type { DesignSession, PartnerScores } from '../../../data/types'
import { designDigest } from '../../../rules/designDigest'
import type { PlanDesignRef } from '../../../rules/designs'
import { DIVE_WORDS } from '../../../rules/designSession'
import {
  DIVE_MAX, followUps, normalizePartnerScores, openingLine, PARTNER_NOTES_MAX, partnerNotesText, PARTNER_ROWS, partnerTotal, ROW_MAX, setDive, setRow,
} from '../../../rules/partnerScores'
import { Button } from '../../../ui/primitives'

export interface PartnerCardProps {
  item: PlanDesignRef
  session: DesignSession
  readOnly?: boolean
  /** F6: false when the card sits inside a screen that already has its one accent (the inline fallback). */
  accent?: boolean
  /** `notes` is left out when the note is empty and nothing was stored (nothing to write); an emptied stored note is sent as '' */
  onSave: (patch: { name: string; scores: PartnerScores; notes?: string }) => Promise<void>
}

type Status = '' | 'Saved' | 'Unsaved changes' | 'Saving…' | 'Could not save'

/** What the friend sees: the prompt, follow-up questions, a read-only digest of the design, and a sheet to score it. No AI. */
export function PartnerCard({ item, session, readOnly = false, accent = true, onSave }: PartnerCardProps) {
  const done = session.phase === 'done'
  const off = done || readOnly
  const [scores, setScores] = useState(() => normalizePartnerScores(session.partner?.scores))
  const [name, setName] = useState(session.partner?.name ?? '')
  const [notes, setNotes] = useState(() => partnerNotesText(session.partner?.notes))
  const [asked, setAsked] = useState<ReadonlySet<number>>(new Set())
  const [status, setStatus] = useState<Status>(session.partner?.scores ? 'Saved' : '')
  /** bumped by every edit, so a save that finishes after a newer edit does not claim "Saved" */
  const rev = useRef(0)
  const digest = useMemo(() => designDigest(session), [session])
  const questions = followUps(item.deepDives)
  // The score prefill maps by index onto the session's stored dives, so the rows show those same questions.
  const dives = (session.deepDives.length > 0 ? session.deepDives.map(d => d.q) : item.deepDives).slice(0, 4)

  const dirty = () => { rev.current += 1; setStatus('Unsaved changes') }
  const edit = (next: PartnerScores) => { setScores(next); dirty() }
  const save = async () => {
    const started = rev.current
    setStatus('Saving…')
    const sendNotes = notes !== '' || !!session.partner?.notes
    try { await onSave({ name: name.trim(), scores, ...(sendNotes ? { notes } : {}) }); if (rev.current === started) setStatus('Saved') } catch { if (rev.current === started) setStatus('Could not save') }
  }
  const toggle = (n: number) => setAsked(prev => { const s = new Set(prev); if (s.has(n)) s.delete(n); else s.add(n); return s })

  return (
    <section className="ptc" data-testid="partner-card" aria-label="Partner card">
      <div className="ptc-main">
      <div className="sr-panel ptc-block">
        <p className="ds-sub">The prompt</p>
        <h2 className="ptc-title" data-testid="partner-prompt" data-content="plan">{item.title}</h2>
        <p className="ptc-opener">Open with: <span data-testid="partner-opener">{openingLine(item.title)}</span></p>
      </div>
      <div className="sr-panel ptc-block">
        <div className="ptc-row"><p className="ds-sub">Follow-up questions</p><span className="ptc-meta">{asked.size} of {questions.length} asked</span></div>
        <ol className="ptc-questions">
          {questions.map(q => (
            <li key={q.n} className="ptc-qtile" data-testid={`partner-question-${q.n}`} data-asked={asked.has(q.n) ? 'true' : 'false'} {...(q.generic ? { 'data-generic': 'true' } : {})}>
              <span className="ptc-qn" aria-hidden="true">{q.n}</span>
              <span className="ptc-q" data-content="plan">{q.text}</span>
              <label className="ptc-asked"><input type="checkbox" data-testid={`partner-asked-${q.n}`} checked={asked.has(q.n)} onChange={() => toggle(q.n)} /><span>Asked</span></label>
            </li>
          ))}
        </ol>
      </div>
      <details className="sr-panel ptc-block" open>
        <summary>The design so far (read only)</summary>
        <pre className="ptc-digest" data-testid="partner-digest" data-content="learner" tabIndex={0}>{digest}</pre>
      </details>
      </div>
      <div className="ptc-side">
      <form className="ptc-form" aria-label="Scoring sheet" noValidate onSubmit={e => e.preventDefault()}>
      <div className="sr-panel ptc-block">
        <div className="ptc-row"><p className="ds-sub">Scoring sheet</p><span className="ptc-meta">0 weak · 4 strong</span></div>
        {off && <p className="ptc-note">{done ? 'This session is finished.' : 'This browser is read-only: open the card from the Dojo window to score.'}</p>}
        {PARTNER_ROWS.map(r => (
          <div key={r.n} role="radiogroup" aria-label={r.item} className="ptc-score" data-testid={`partner-score-${r.n}`}>
            <span className="ptc-score-name">{r.item}<small>{r.hint}</small></span>
            {/* the same radios as ever (0 to 4, one name per row), drawn as a pip bar: a pip is lit up to the chosen value */}
            <span className="ptc-pips">
              {Array.from({ length: ROW_MAX + 1 }, (_, v) => (
                <label key={v} className={`ptc-pip${v === 0 ? ' ptc-pip0' : ''}`} data-on={v > 0 && (scores.perItem[r.n - 1] ?? 0) >= v ? 'true' : 'false'}>
                  <input type="radio" name={`ps-${r.n}`} aria-label={String(v)} data-testid={`partner-score-${r.n}-${v}`} disabled={off} checked={scores.perItem[r.n - 1] === v} onChange={() => edit(setRow(scores, r.n, v))} />
                  {v === 0 && <span aria-hidden="true">0</span>}
                </label>
              ))}
            </span>
            <span className="ptc-val" aria-hidden="true">{scores.perItem[r.n - 1] == null ? '–' : `${scores.perItem[r.n - 1]}/${ROW_MAX}`}</span>
          </div>
        ))}
        <p className="ptc-total" data-testid="partner-total">{partnerTotal(scores)} of {PARTNER_ROWS.length * ROW_MAX}</p>
        <p className="ds-sub">Deep dives</p>
        <p className="ptc-note">{([0, 1, 2] as const).map(v => `${v} ${DIVE_WORDS[v]}`).join(' · ')}</p>
        {dives.map((q, i) => (
          <div key={i} role="radiogroup" aria-label={q} data-content-label="plan" className="ptc-score ptc-dive" data-testid={`partner-score-dive-${i + 1}`}>
            <span className="ptc-score-name" data-content="plan">{q}</span>
            <span className="ptc-pips">
              {Array.from({ length: DIVE_MAX + 1 }, (_, v) => (
                <label key={v} className={`ptc-pip${v === 0 ? ' ptc-pip0' : ''}`} data-on={v > 0 && (scores.deepDives[i] ?? 0) >= v ? 'true' : 'false'}>
                  <input type="radio" name={`pd-${i + 1}`} aria-label={String(v)} data-testid={`partner-score-dive-${i + 1}-${v}`} disabled={off} checked={scores.deepDives[i] === v} onChange={() => edit(setDive(scores, i + 1, v))} />
                  {v === 0 && <span aria-hidden="true">0</span>}
                </label>
              ))}
            </span>
            <span className="ptc-val" aria-hidden="true">{scores.deepDives[i] == null ? '–' : `${scores.deepDives[i]}/${DIVE_MAX}`}</span>
          </div>
        ))}
        <label className="ds-field"><span>Your name</span><input type="text" data-testid="partner-name" maxLength={40} readOnly={off} value={name} onChange={e => { setName(e.target.value); dirty() }} /></label>
      </div>
      <div className="sr-panel ptc-block">
        <label className="ds-sub" htmlFor="partner-notes">Your notes</label>
        <textarea id="partner-notes" className="ptc-notes" data-testid="partner-notes" data-content="learner" maxLength={PARTNER_NOTES_MAX} disabled={off} value={notes} onChange={e => { setNotes(e.target.value.slice(0, PARTNER_NOTES_MAX)); dirty() }} />
        <div className="ptc-row">
          <span className="ptc-meta">Your scores and notes reach the host when you save. No AI speaks in this mode.</span>
          <span className="ptc-meta ptc-count" data-testid="partner-notes-counter">{notes.length} / {PARTNER_NOTES_MAX}</span>
        </div>
        <p className="ptc-status" role="status" data-testid="partner-status">{status}</p>
        <div className="ptc-actions">
          <Button variant={accent ? 'accent' : 'control'} data-testid="partner-save" {...(accent ? { 'data-accent': 'primary' } : {})} disabled={off || status === 'Saving…'} onClick={() => void save()}>SAVE · SCORES</Button>
        </div>
      </div>
      </form>
      </div>
    </section>
  )
}

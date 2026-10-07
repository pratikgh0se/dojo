import { useState } from 'react'
import { DAY_TYPES, DELIVERABLE_KINDS, type BriefQuestion, type DayType, type DeliverableKind } from '../../ai/types'
import { useDb } from '../../app/providers'
import { cleanEdit, isWebUrl, saveBrief, type BriefEdit } from '../../data/briefActions'
import { safeWrite } from '../../data/safeWrite'
import type { Brief, Ticket } from '../../data/types'
import { isLearning, newQuestionId } from '../../rules/brief'
import { Button, useToast } from '../../ui/primitives'
import { Dialog } from '../ai/Dialog'
import './brief.css'

const KIND_LABEL: Record<DeliverableKind, string> = { answers: 'Answers to questions', code: 'Code', artifact: 'Artifact', note: 'Note', explanation: 'Explanation' }

/** "Edit brief" (Addendum 1 Q3): goal, steps with links, minutes, day type, what you'll learn, outcome, deliverable and questions. */
export function BriefEditor({ ticket, brief, onClose, returnFocus }: { ticket: Ticket; brief: Brief; onClose: () => void; returnFocus: () => HTMLElement | null }) {
  const d = useDb()
  const toast = useToast()
  const [draft, setDraft] = useState<BriefEdit>(() => ({
    goal: brief.goal, steps: brief.steps.map(s => ({ ...s })), minutes: brief.minutes, dayType: brief.dayType, learn: [...brief.learn],
    outcome: brief.outcome, deliverable: { ...brief.deliverable }, questions: brief.questions.map(q => ({ ...q, ...(q.choices ? { choices: [...q.choices] } : {}), ...(q.keyIdeas ? { keyIdeas: [...q.keyIdeas] } : {}) })),
  }))
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof BriefEdit>(k: K, v: BriefEdit[K]) => setDraft(x => ({ ...x, [k]: v }))
  const setQ = (i: number, patch: Partial<BriefQuestion>) => set('questions', draft.questions.map((q, k) => (k === i ? { ...q, ...patch } : q)))

  async function save() {
    const clean = cleanEdit(draft)
    if (!clean.goal) return setError('A brief needs a goal')
    if (clean.steps.length === 0) return setError('A brief needs at least one step')
    if (draft.steps.some(s => s.url?.trim() && !isWebUrl(s.url.trim()))) return setError('Links must start with http:// or https://')
    if (isLearning(ticket) && draft.questions.filter(q => q.q.trim()).length === 0) return setError('A learning card needs at least one question')
    if (draft.questions.some(q => !q.q.trim())) return setError('Every question needs its text')
    const r = await safeWrite(() => saveBrief(d, ticket.id, clean), m => toast(m, 'danger'))
    if (!r) return
    if (!r.ok) return setError(r.message)
    onClose()
  }

  return (
    <Dialog title="Edit brief" testId="brief-editor" onClose={onClose} returnFocus={returnFocus}>
      <div className="p-form">
        <div className="p-field">
          <label htmlFor="bf-goal">Goal</label>
          <input id="bf-goal" value={draft.goal} onChange={e => set('goal', e.target.value)} />
        </div>
        <div className="bf-steps">
          {draft.steps.map((s, i) => (
            <div className="bf-step" key={i}>
              <div className="p-field">
                <label htmlFor={`bf-st-${i}`}>Step {i + 1} text</label>
                <input id={`bf-st-${i}`} value={s.text} onChange={e => set('steps', draft.steps.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))} />
              </div>
              <div className="p-field">
                <label htmlFor={`bf-sl-${i}`}>Step {i + 1} link</label>
                <input id={`bf-sl-${i}`} value={s.url ?? ''} placeholder="https://" onChange={e => set('steps', draft.steps.map((x, k) => (k === i ? { ...x, url: e.target.value } : x)))} />
              </div>
              <Button variant="quiet" aria-label={`Remove step ${i + 1}`} onClick={() => set('steps', draft.steps.filter((_, k) => k !== i))}>Remove</Button>
            </div>
          ))}
          <div><Button onClick={() => set('steps', [...draft.steps, { text: '' }])}>Add step</Button></div>
        </div>
        <div className="p-field">
          <label htmlFor="bf-min">Minutes</label>
          <input id="bf-min" type="number" min={5} max={480} value={draft.minutes} onChange={e => set('minutes', Number(e.target.value))} />
        </div>
        <div className="p-field">
          <label htmlFor="bf-day">Day type</label>
          <select id="bf-day" value={draft.dayType} onChange={e => set('dayType', e.target.value as DayType)}>
            {DAY_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div className="p-field">
          <label htmlFor="bf-learn">What you&apos;ll learn (one per line)</label>
          <textarea id="bf-learn" value={draft.learn.join('\n')} onChange={e => set('learn', e.target.value.split('\n'))} />
        </div>
        <div className="p-field">
          <label htmlFor="bf-out">Outcome</label>
          <textarea id="bf-out" value={draft.outcome} onChange={e => set('outcome', e.target.value)} />
        </div>
        <div className="p-field">
          <label htmlFor="bf-dk">Deliverable kind</label>
          <select id="bf-dk" value={draft.deliverable.kind} onChange={e => set('deliverable', { ...draft.deliverable, kind: e.target.value as DeliverableKind })}>
            {DELIVERABLE_KINDS.map(k => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </div>
        <div className="p-field">
          <label htmlFor="bf-dp">Deliverable prompt</label>
          <input id="bf-dp" value={draft.deliverable.prompt} onChange={e => set('deliverable', { ...draft.deliverable, prompt: e.target.value })} />
        </div>
        {draft.questions.map((q, i) => (
          <div className="bf-question" key={q.id}>
            <div className="p-field">
              <label htmlFor={`bf-q-${i}`}>Question {i + 1}</label>
              <input id={`bf-q-${i}`} value={q.q} onChange={e => setQ(i, { q: e.target.value })} />
            </div>
            {q.kind === 'open' ? (
              <div className="p-field">
                <label htmlFor={`bf-ki-${i}`}>Question {i + 1} key ideas (comma separated)</label>
                <input id={`bf-ki-${i}`} value={(q.keyIdeas ?? []).join(', ')} onChange={e => setQ(i, { keyIdeas: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} />
              </div>
            ) : (
              <>
                {(q.choices ?? []).map((c, k) => (
                  <div className="p-field" key={k}>
                    <label htmlFor={`bf-qc-${i}-${k}`}>Question {i + 1} choice {k + 1}</label>
                    <input id={`bf-qc-${i}-${k}`} value={c} onChange={e => setQ(i, { choices: (q.choices ?? []).map((x, j) => (j === k ? e.target.value : x)) })} />
                  </div>
                ))}
                <div className="p-field">
                  <label htmlFor={`bf-qr-${i}`}>Question {i + 1} correct choice</label>
                  <select id={`bf-qr-${i}`} value={q.correct ?? 0} onChange={e => setQ(i, { correct: Number(e.target.value) })}>
                    {(q.choices ?? []).map((_, k) => <option key={k} value={k}>Choice {k + 1}</option>)}
                  </select>
                </div>
              </>
            )}
            <div><Button variant="quiet" aria-label={`Remove question ${i + 1}`} onClick={() => set('questions', draft.questions.filter((_, k) => k !== i))}>Remove question</Button></div>
          </div>
        ))}
        <div><Button onClick={() => set('questions', [...draft.questions, { id: newQuestionId(draft.questions), kind: 'open', q: '', keyIdeas: [] }])}>Add question</Button></div>
        {error && <p className="p-err" role="alert">{error}</p>}
        <div className="p-actions">
          <Button variant="accent" onClick={() => void save()}>Save</Button>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  )
}

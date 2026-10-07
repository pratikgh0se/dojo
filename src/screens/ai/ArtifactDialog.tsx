import { useId, useState, type ReactNode } from 'react'
import { useDb } from '../../app/providers'
import { CAPSTONE_STAGES } from '../../content/capstoneStages'
import { createArtifact, deleteArtifact, updateArtifact } from '../../data/projectActions'
import { safeWrite } from '../../data/safeWrite'
import type { ArtifactStatus } from '../../data/types'
import { now } from '../../lib/clock'
import { pad2 } from '../../lib/dates'
import {
  formEvidence, formOf, isDone, moveBlocked, STATUS_LABEL, STATUS_ORDER, TITLE_MAX, validateForm,
  type ArtifactForm, type ArtifactRecord, type FormField,
} from '../../rules/artifacts'
import { commitCheckText } from '../../rules/grade'
import { Button, useToast } from '../../ui/primitives'
import { Dialog } from './Dialog'
import { GradeSection } from './GradeSection'
import { MeasuresSection } from './MeasuresSection'

export interface ArtifactDialogProps {
  artifact: ArtifactRecord | null
  startDate: string
  onClose: () => void
  onSaved: (id: string) => void
  onDeleted: () => void
  returnFocus: () => HTMLElement | null
}

function TextField({
  id, label, testId, value, error, maxLength, onChange, children,
}: {
  id: string; label: string; testId: string; value: string; error?: string; maxLength?: number
  onChange: (v: string) => void; children?: ReactNode
}) {
  return (
    <div className="p-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        data-testid={testId}
        value={value}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={e => onChange(e.target.value)}
      />
      <p className="p-err p-err-slot" id={`${id}-err`} role={error ? 'alert' : undefined}>{error}</p>
      {children}
    </div>
  )
}

/** C-PROJECTS §2.5. New (`artifact === null`) or existing; Save persists and closes, Cancel discards. */
export function ArtifactDialog({ artifact, startDate, onClose, onSaved, onDeleted, returnFocus }: ArtifactDialogProps) {
  const d = useDb()
  const toast = useToast()
  const uid = useId()
  const [form, setForm] = useState<ArtifactForm>(() => formOf(artifact))
  const [titleTouched, setTitleTouched] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const errors = validateForm(form)
  const shown = (k: FormField): string | undefined => (k === 'title' && !titleTouched && !attempted ? undefined : errors[k])
  const fid = (k: string) => `${uid}-${k}`
  const savedStatus: ArtifactStatus = artifact?.status ?? 'not started'
  const check = artifact ? commitCheckText(artifact) : null
  const edit = <K extends keyof ArtifactForm>(k: K, v: ArtifactForm[K]) => setForm(f => ({ ...f, [k]: v }))

  function pickStatus(to: ArtifactStatus) {
    const blocked = moveBlocked(formEvidence(form, artifact?.measures ?? []), savedStatus, to)
    if (blocked) {
      setStatusError(blocked)
      return
    }
    setStatusError(null)
    edit('status', to)
  }

  async function save() {
    setAttempted(true)
    if (Object.keys(errors).length > 0) return
    const at = now()
    const res = await safeWrite(
      () => (artifact ? updateArtifact(d, artifact.id, form, at) : createArtifact(d, form, at)),
      m => toast(m, 'danger'),
    )
    if (!res) return
    if (!res.ok) {
      setStatusError(res.message)
      return
    }
    onSaved(res.artifact.id)
  }

  async function remove() {
    if (!artifact) return
    const ok = await safeWrite(() => deleteArtifact(d, artifact.id), m => toast(m, 'danger'))
    if (ok) onDeleted()
  }

  return (
    <Dialog
      title={artifact ? `Artifact · ${artifact.title}` : 'New artifact'}
      testId="artifact-dialog"
      onClose={onClose}
      returnFocus={returnFocus}
      headerExtra={artifact && isDone(artifact) ? <span className="p-done" data-testid="artifact-done">Done</span> : null}
    >
      <form className="p-form" noValidate onSubmit={e => { e.preventDefault(); void save() }}>
        <TextField
          id={fid('title')} label="Title" testId="artifact-title" value={form.title} error={shown('title')} maxLength={TITLE_MAX}
          onChange={v => { edit('title', v); setTitleTouched(true) }}
        />
        <div className="p-field">
          <label htmlFor={fid('stage')}>Stage</label>
          <select id={fid('stage')} data-testid="artifact-stage" value={form.stage} onChange={e => edit('stage', Number(e.target.value))}>
            {CAPSTONE_STAGES.map(s => <option key={s.stage} value={s.stage}>Stage {pad2(s.stage)}</option>)}
          </select>
        </div>
        <TextField id={fid('repo')} label="Repo URL" testId="artifact-repo" value={form.repo} error={shown('repo')} onChange={v => edit('repo', v)} />
        <TextField id={fid('commit')} label="Commit" testId="artifact-commit" value={form.commit} error={shown('commit')} onChange={v => edit('commit', v)}>
          {check && <p className="p-note" data-testid="artifact-commit-checked">{check}</p>}
        </TextField>
        <TextField id={fid('writeup')} label="Write-up link" testId="artifact-writeup" value={form.writeup} error={shown('writeup')} onChange={v => edit('writeup', v)} />
        <div className="p-field">
          <label htmlFor={fid('note')}>Proof note</label>
          <textarea id={fid('note')} data-testid="artifact-note" value={form.note} placeholder="What runs, what you measured" onChange={e => edit('note', e.target.value)} />
        </div>
        <div className="p-field">
          <label htmlFor={fid('status')}>Status</label>
          <select id={fid('status')} data-testid="artifact-status" value={form.status} onChange={e => pickStatus(e.target.value as ArtifactStatus)}>
            {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          {statusError && <p className="p-err" role="alert" data-testid="artifact-status-error">{statusError}</p>}
        </div>
      </form>
      {artifact && <MeasuresSection artifact={artifact} startDate={startDate} />}
      {artifact && <GradeSection artifact={artifact} />}
      <div className="p-actions">
        <Button variant="accent" data-testid="artifact-save" onClick={() => void save()}>Save</Button>
        <Button variant="quiet" onClick={onClose}>Cancel</Button>
        {artifact?.userAdded && (
          <Button variant="danger" data-testid="artifact-delete" onClick={() => setConfirming(true)}>Delete artifact</Button>
        )}
      </div>
      {confirming && artifact && (
        <Dialog
          role="alertdialog"
          title="Delete this artifact?"
          testId="artifact-delete-confirm"
          onClose={() => setConfirming(false)}
          initialFocus={() => document.querySelector<HTMLElement>('[data-testid="artifact-delete-keep"]')}
          returnFocus={() => document.querySelector<HTMLElement>('[data-testid="artifact-delete"]')}
        >
          <p className="p-note">{artifact.title}, its measures and its grade go away.</p>
          <div className="p-actions">
            <Button variant="danger" data-testid="artifact-delete-yes" onClick={() => void remove()}>Delete</Button>
            <Button variant="quiet" data-testid="artifact-delete-keep" onClick={() => setConfirming(false)}>Keep</Button>
          </div>
        </Dialog>
      )}
    </Dialog>
  )
}

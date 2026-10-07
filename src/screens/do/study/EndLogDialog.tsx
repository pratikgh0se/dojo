import { useMemo, useState } from 'react'
import { END_LOG_MAX } from '../../../data/sessionActions'
import type { EndLog } from '../../../data/types'
import { loadEndDraft, saveEndDraft } from '../../../lib/endDraft'
import { loadStudy } from '../../../lib/studyStore'
import { Button } from '../../../ui/primitives'
import { Dialog } from '../../ai/Dialog'
import './study.css'

/** UX-10: three optional short fields. Named "End session"; the button is "Save". */
export function EndLogDialog({ saving, onSave, onCancel }: { saving: boolean; onSave: (log: EndLog) => void; onCancel: () => void }) {
  // P3-8: "Keep going" closes this dialog without losing what was typed; the draft is the session's, and ends with it
  const sid = useMemo(() => loadStudy()?.id ?? '', [])
  const [log, setLog] = useState<EndLog>(() => loadEndDraft(sid))
  const { done, stuckOn, nextStep } = log
  const edit = (patch: Partial<EndLog>) => setLog(cur => {
    const next = { ...cur, ...patch }
    if (sid) saveEndDraft(sid, next)
    return next
  })
  const setDone = (v: string) => edit({ done: v })
  const setStuckOn = (v: string) => edit({ stuckOn: v })
  const setNextStep = (v: string) => edit({ nextStep: v })
  const field = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="p-field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} value={value} maxLength={END_LOG_MAX} rows={2} onChange={e => set(e.target.value)} />
      <span className="study-count" aria-hidden="true">{value.length} / {END_LOG_MAX}</span>
    </div>
  )
  return (
    <Dialog title="End session" testId="end-dialog" onClose={onCancel}>
      <div className="study-form">
        {field('end-done', 'Done', done, setDone)}
        {field('end-stuck', 'Stuck on', stuckOn, setStuckOn)}
        {field('end-next', 'Next step', nextStep, setNextStep)}
        <div className="p-actions">
          <Button variant="accent" data-testid="end-save" disabled={saving} onClick={() => onSave({ done, stuckOn, nextStep })}>Save</Button>
          <Button variant="quiet" onClick={onCancel}>Keep going</Button>
        </div>
      </div>
    </Dialog>
  )
}

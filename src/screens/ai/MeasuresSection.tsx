import { useId, useState } from 'react'
import { useDb } from '../../app/providers'
import { addMeasure, removeMeasure } from '../../data/projectActions'
import { safeWrite } from '../../data/safeWrite'
import { now } from '../../lib/clock'
import type { ArtifactRecord } from '../../rules/artifacts'
import {
  EMPTY_MEASURE, MEASURE_CHOICES, measureText, validateMeasure, type MeasureChoice, type MeasureInput,
} from '../../rules/measures'
import { Button, useToast } from '../../ui/primitives'

/**
 * C-PROJECTS §2.5 measures: persisted on Add (not on Save). Each list item's text is exactly
 * "<name> <value>[ <unit>] · S<n>"; the Remove button is drawn by CSS (no visible text) and
 * named by aria-label "Remove <name> <value>".
 */
export function MeasuresSection({ artifact, startDate }: { artifact: ArtifactRecord; startDate: string }) {
  const d = useDb()
  const toast = useToast()
  const uid = useId()
  const [input, setInput] = useState<MeasureInput>(EMPTY_MEASURE)
  const [attempted, setAttempted] = useState(false)
  const errs = validateMeasure(input)
  const fid = (k: string) => `${uid}-${k}`
  const patch = (p: Partial<MeasureInput>) => setInput(i => ({ ...i, ...p }))

  async function add() {
    setAttempted(true)
    if (Object.keys(errs).length > 0) return
    const res = await safeWrite(() => addMeasure(d, artifact.id, input, now(), startDate), m => toast(m, 'danger'))
    if (!res) return
    if (!res.ok) {
      toast(res.message, 'danger')
      return
    }
    setInput(i => ({ ...i, name: '', value: '', unit: '' }))
    setAttempted(false)
  }

  async function remove(index: number) {
    const res = await safeWrite(() => removeMeasure(d, artifact.id, index), m => toast(m, 'danger'))
    if (res && !res.ok) toast(res.message, 'danger')
  }

  return (
    <div className="p-subsection" data-testid="measure-form">
      <h3 className="p-subtitle">Measures</h3>
      <div className="p-measure-row">
        <div className="p-field">
          <label htmlFor={fid('choice')}>Measure</label>
          <select id={fid('choice')} value={input.choice} onChange={e => patch({ choice: e.target.value as MeasureChoice })}>
            {MEASURE_CHOICES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <p className="p-err p-err-slot" aria-hidden="true" />
        </div>
        {input.choice === 'other' && (
          <div className="p-field">
            <label htmlFor={fid('name')}>Name</label>
            <input id={fid('name')} value={input.name} onChange={e => patch({ name: e.target.value })} />
            <p className="p-err p-err-slot">{attempted ? errs.name : ''}</p>
          </div>
        )}
        <div className="p-field">
          <label htmlFor={fid('value')}>Value</label>
          <input
            id={fid('value')}
            type="number"
            step="any"
            inputMode="decimal"
            required
            value={input.value}
            onChange={e => patch({ value: e.target.value })}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void add()
              }
            }}
          />
          <p className="p-err p-err-slot">{attempted ? errs.value : ''}</p>
        </div>
        <div className="p-field">
          <label htmlFor={fid('unit')}>Unit</label>
          <input id={fid('unit')} value={input.unit} onChange={e => patch({ unit: e.target.value })} />
          <p className="p-err p-err-slot" aria-hidden="true" />
        </div>
        <Button data-testid="measure-add" onClick={() => void add()}>Add measure</Button>
      </div>
      <ul className="p-measure-list" data-testid="measure-list">
        {artifact.measures.map((m, i) => (
          <li key={`${m.at}-${i}`}>
            {measureText(m)} · S{m.sprint}
            <button
              type="button"
              className="sr-btn sr-btn-quiet p-remove"
              aria-label={`Remove ${m.name} ${m.value}`}
              onClick={() => void remove(i)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

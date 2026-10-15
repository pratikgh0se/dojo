import { useState } from 'react'
import { FORMS, formOf } from '../rules/forms'
import { PomStage } from '../ui/engines/PomStage'
import { usePlayFormUp } from '../ui/PomReward'
import { Button, Panel } from '../ui/primitives'

/**
 * SET-09 to SET-11: look at any Pom form, play the form-up celebration and see which form a level earns.
 * It keeps its own state and never reads or writes the data, so it works the same in a read-only browser.
 */
export function DebugPom() {
  const play = usePlayFormUp()
  const [form, setForm] = useState(0)
  const [level, setLevel] = useState('')
  const lv = /^\d+$/.test(level.trim()) ? Number(level) : null
  return (
    <Panel title="Debug · Pom" data-testid="settings-debug-pom">
      <div className="dbg-pom">
        <div className="dbg-well" aria-hidden="true">
          <PomStage form={form} pose="idle" label={`Pom, form ${FORMS[form]}`} data-testid="settings-debug-pom-stage" data-form={form} />
        </div>
        <div className="dbg-pom-controls">
          <label>
            Form
            <select data-testid="settings-debug-pom-form" value={form} onChange={e => setForm(Number(e.target.value))}>
              {FORMS.map((name, i) => <option key={name} value={i}>{name}</option>)}
            </select>
          </label>
          <Button type="button" data-testid="settings-debug-pom-play" onClick={() => play(form)}>Play form-up</Button>
          <label>
            Level
            <input type="number" min={0} step={1} className="num-160" data-testid="settings-debug-pom-level" value={level} onChange={e => setLevel(e.target.value)} />
          </label>
          <p className="settings-note">Form for that level: <strong data-testid="settings-debug-pom-result">{lv === null ? '' : formOf(lv * 10).name}</strong></p>
        </div>
      </div>
    </Panel>
  )
}

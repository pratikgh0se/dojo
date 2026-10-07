import { useState } from 'react'
import type { DesignSession } from '../../data/types'
import type { PlanDesignRef } from '../../rules/designs'
import { ExtLink } from '../../ui/Prose'
import { Button } from '../../ui/primitives'
import { DeepDiveList } from './DeepDiveList'

export function SetupPanel({
  item, redo, onStart,
}: { item: PlanDesignRef; redo: DesignSession | null; onStart: (mode: 'solo' | 'interviewer') => void }) {
  const [mode, setMode] = useState<'solo' | 'interviewer'>('solo')
  return (
    <section className="sr-panel ds-setup" data-testid="session-setup" aria-label="Setup">
      {redo && <p className="ds-redo">Redesign pass · previous rubric {redo.rubric}</p>}
      <h2 className="sr-panel-title">Deep dives</h2>
      <DeepDiveList dives={item.deepDives} />
      {item.refs.length > 0 && (
        <p className="ds-refs">{item.refs.map(r => <ExtLink key={r.url} link={r} />)}</p>
      )}
      <div role="radiogroup" aria-label="Mode" className="ds-mode">
        <label className="sr-choice"><input type="radio" name="ds-mode" checked={mode === 'solo'} onChange={() => setMode('solo')} /> Solo</label>
        <label className="sr-choice"><input type="radio" name="ds-mode" checked={mode === 'interviewer'} onChange={() => setMode('interviewer')} /> Interviewer</label>
      </div>
      <Button variant="accent" onClick={() => onStart(mode)}>Start · 45 min</Button>
    </section>
  )
}

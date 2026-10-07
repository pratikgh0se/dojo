import { useMemo, useState } from 'react'
import { isContainer } from '../../../rules/brief'
import { useTickets } from '../../../data/hooks'
import type { Ticket } from '../../../data/types'
import { primeChime } from '../../../lib/chime'
import { Button } from '../../../ui/primitives'
import { Dialog } from '../../ai/Dialog'
import './study.css'

export type CycleChoice = '25/5' | '50/10' | 'custom'
export interface PlanResult { goal: string; focusMin: number; breakMin: number; cardIds: string[]; chime: boolean }

export const CYCLES: Record<Exclude<CycleChoice, 'custom'>, { focusMin: number; breakMin: number }> = {
  '25/5': { focusMin: 25, breakMin: 5 },
  '50/10': { focusMin: 50, breakMin: 10 },
}
/** shell-today-board A2: every other unfinished card of the same sprint, whatever its track, in plan order. */
export function otherCards(all: readonly Ticket[], ticket: Ticket): Ticket[] {
  return all
    .filter(t => t.id !== ticket.id && !t.archived && t.status !== 'done' && t.sprint === ticket.sprint && !isContainer(t))
    .sort((a, b) => a.order - b.order)
}

/** UX-06: the plan step. Named "Plan this session"; the cycle is a radio choice. */
export function PlanDialog({
  ticket, chime, onStart, onCancel,
}: { ticket: Ticket; chime: boolean; onStart: (p: PlanResult) => void; onCancel: () => void }) {
  const all = useTickets()
  const others = useMemo(() => otherCards(all ?? [], ticket), [all, ticket])
  const [goal, setGoal] = useState('')
  const [cycle, setCycle] = useState<CycleChoice>('25/5')
  const [focus, setFocus] = useState('25')
  const [brk, setBrk] = useState('5')
  const [picked, setPicked] = useState<string[]>([])
  const [chimeOn, setChimeOn] = useState(chime)
  const [error, setError] = useState<{ field: 'focus' | 'break'; message: string } | null>(null)

  // M4 (rerun): the app's own error shows as soon as a custom value is out of range, and again on Start
  function check(fv: string, bv: string): { field: 'focus' | 'break'; message: string } | null {
    const f = Math.round(Number(fv))
    const b = Math.round(Number(bv))
    if (fv.trim() === '' || !(f >= 1 && f <= 180)) return { field: 'focus', message: 'Focus minutes must be 1 to 180.' }
    if (bv.trim() === '' || !(b >= 1 && b <= 60)) return { field: 'break', message: 'Break minutes must be 1 to 60.' }
    return null
  }

  function start() {
    let plan: { focusMin: number; breakMin: number }
    if (cycle === 'custom') {
      const bad = check(focus, brk)
      setError(bad)
      if (bad) return
      plan = { focusMin: Math.round(Number(focus)), breakMin: Math.round(Number(brk)) }
    } else plan = CYCLES[cycle]
    if (chimeOn) primeChime() // inside the click: the autoplay policy lets a later block-end chime sound
    onStart({ goal: goal.trim(), ...plan, cardIds: [ticket.id, ...picked], chime: chimeOn })
  }

  return (
    <Dialog title="Plan this session" testId="plan-dialog" onClose={onCancel}>
      <div className="study-form">
        <fieldset className="study-fieldset">
          <legend>Cards</legend>
          {/* A2: more than 6 cards scroll inside a well of max-height 264 */}
          <div className={`study-cards${others.length + 1 > 6 ? ' study-cards-well sc' : ''}`} data-testid="study-cards">
          <label className="sr-choice">
            <input type="checkbox" checked disabled readOnly />
            <span>{ticket.title}</span>
          </label>
          {others.map(o => (
            <label key={o.id} className="sr-choice">
              <input
                type="checkbox" checked={picked.includes(o.id)}
                onChange={e => setPicked(p => (e.target.checked ? [...p, o.id] : p.filter(x => x !== o.id)))}
              />
              <span>{o.title}</span>
            </label>
          ))}
          </div>
        </fieldset>
        <div className="p-field">
          <label htmlFor="study-goal">This session I will</label>
          <input id="study-goal" type="text" value={goal} maxLength={200} onChange={e => setGoal(e.target.value)} />
        </div>
        <fieldset className="study-fieldset" role="radiogroup" aria-label="Cycle">
          <legend>Cycle</legend>
          {(['25/5', '50/10', 'custom'] as const).map(c => (
            <label key={c} className="sr-choice">
              <input type="radio" name="study-cycle" value={c} checked={cycle === c} onChange={() => setCycle(c)} />
              <span>{c === 'custom' ? 'Custom' : c === '25/5' ? '25 / 5' : '50 / 10'}</span>
            </label>
          ))}
          {cycle === 'custom' && (
            <div className="study-custom">
              {/* Q20: min/max expose the range; the app's own error fires on input and on blur (M4) */}
              <div className="p-field">
                <label htmlFor="study-focus">Focus minutes</label>
                <input id="study-focus" type="number" min={1} max={180} onBlur={e => setError(check(e.target.value, brk))} value={focus} aria-invalid={error?.field === 'focus' ? true : undefined} onChange={e => { setFocus(e.target.value); setError(check(e.target.value, brk)) }} />
              </div>
              <div className="p-field">
                <label htmlFor="study-break">Break minutes</label>
                <input id="study-break" type="number" min={1} max={60} onBlur={e => setError(check(focus, e.target.value))} value={brk} aria-invalid={error?.field === 'break' ? true : undefined} onChange={e => { setBrk(e.target.value); setError(check(focus, e.target.value)) }} />
              </div>
            </div>
          )}
          {cycle === 'custom' && error && <p role="alert" className="form-error" data-testid="form-error">{error.message}</p>}
        </fieldset>
        <label className="sr-choice">
          <input type="checkbox" checked={chimeOn} onChange={e => setChimeOn(e.target.checked)} />
          <span>Soft chime at each switch</span>
        </label>
        <div className="p-actions">
          <Button variant="accent" data-testid="plan-start" onClick={start}>Start</Button>
          <Button variant="quiet" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  )
}

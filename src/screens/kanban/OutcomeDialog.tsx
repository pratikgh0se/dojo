import { useEffect } from 'react'
import { Button } from '../../ui/primitives'
import { Dialog } from '../ai/Dialog'

export type ProblemOutcome = 'solved' | 'solved_help' | 'gave_up'

/** BOARD-25: a problem moved to Done asks how it went first. Nothing is written until one of the three is chosen; Esc, Cancel and the backdrop write nothing. */
export function OutcomeDialog({ onChoose, onCancel }: { onChoose: (o: ProblemOutcome) => void; onCancel: () => void }) {
  useEffect(() => {
    const click = (e: MouseEvent) => { if (e.target instanceof Element && e.target.classList.contains('p-backdrop')) onCancel() }
    document.addEventListener('click', click)
    return () => document.removeEventListener('click', click)
  }, [onCancel])
  return (
    <Dialog title="How did it go?" testId="kanban-outcome" onClose={onCancel}>
      <div className="p-actions kb-outcome">
        <Button data-testid="kanban-outcome-solved" onClick={() => onChoose('solved')}>Solved</Button>
        <Button data-testid="kanban-outcome-help" onClick={() => onChoose('solved_help')}>Solved with help</Button>
        <Button data-testid="kanban-outcome-giveup" onClick={() => onChoose('gave_up')}>Gave up</Button>
        <Button variant="quiet" data-testid="kanban-outcome-cancel" onClick={onCancel}>Cancel</Button>
      </div>
    </Dialog>
  )
}

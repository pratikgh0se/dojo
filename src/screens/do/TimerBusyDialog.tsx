import { useRef } from 'react'
import { Dialog } from '../ai/Dialog'
import { Button } from '../../ui/primitives'

/**
 * UAT cu-4 P3-5: Start (a session, a 25/50/custom timer) while another card owns the one running timer or study session.
 * It used to answer with a 1.4 s toast; now it says which card, and offers the way on.
 *  - a plain timer on another card: stop it and start here, go and look at it, or cancel;
 *  - a study session on another card: it has its own End log, so it is not ended from here: go to it, or cancel.
 * Enter or Space on the focused choice acts; Esc cancels; focus starts on Cancel (the safe choice).
 */
export function TimerBusyDialog({
  kind, title, startLabel, onStop, onGo, onCancel,
}: {
  kind: 'timer' | 'session'; title: string
  /** what stopping lets happen, in the button's own words ("Stop it and start the session") */
  startLabel: string
  onStop: () => void; onGo: () => void; onCancel: () => void
}) {
  const safe = useRef<HTMLButtonElement>(null)
  return (
    <Dialog
      title={kind === 'timer' ? 'A timer is already running' : 'A study session is already running'}
      testId="timer-busy-dialog" role="alertdialog" onClose={onCancel}
      initialFocus={() => safe.current}
    >
      <div className="p-form">
        <p className="brief-text" data-testid="timer-busy-text">
          {kind === 'timer'
            ? `The timer on “${title}” is still running. Only one timer runs at a time.`
            : `You are in a study session on “${title}”. End it there first: only one session or timer runs at a time.`}
        </p>
        <div className="p-actions">
          {kind === 'timer' && <Button variant="accent" data-testid="timer-busy-stop" onClick={onStop}>{startLabel}</Button>}
          <Button variant={kind === 'timer' ? 'control' : 'accent'} data-testid="timer-busy-go" onClick={onGo}>Go to that card</Button>
          <Button variant="quiet" ref={safe} data-testid="timer-busy-cancel" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </Dialog>
  )
}

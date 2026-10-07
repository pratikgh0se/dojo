import { useRef } from 'react'
import { Button } from '../../../ui/primitives'
import { Dialog } from '../../ai/Dialog'
import './study.css'

/** UX-09: a gentle prompt, never automatic. Shown at most once per focus block. */
export function StuckDialog({
  onNextRung, onBreak, onFine, noRung = null,
}: {
  onNextRung: () => void; onBreak: () => void; onFine: () => void
  /** UAT cu-4 P3-5: why no help rung can be opened yet (read before the click, on the page, not a 2 s toast); null when one can */
  noRung?: string | null
}) {
  const fine = useRef<HTMLButtonElement>(null)
  return (
    // the safe answer holds focus, so a stray Enter or Space never opens a rung that costs XP
    <Dialog title="Stuck?" testId="stuck-dialog" onClose={onFine} initialFocus={() => fine.current}>
      <p className="study-note">That focus block passed with no help rung opened, no note typed and no tick. Nothing happens unless you choose.</p>
      {noRung && <p className="study-note" id="stuck-no-rung" data-testid="stuck-no-rung">{noRung}</p>}
      <div className="p-actions">
        <Button variant="accent" data-testid="stuck-rung" disabled={noRung !== null} aria-describedby={noRung ? 'stuck-no-rung' : undefined} onClick={onNextRung}>Open the next help rung</Button>
        <Button data-testid="stuck-break" onClick={onBreak}>Take a 5-minute break</Button>
        <Button ref={fine} variant="quiet" data-testid="stuck-fine" onClick={onFine}>I&apos;m fine</Button>
      </div>
    </Dialog>
  )
}

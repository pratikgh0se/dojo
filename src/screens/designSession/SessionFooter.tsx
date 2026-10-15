import { gradedText } from '../../rules/designSession'
import { Button } from '../../ui/primitives'
import { AutosaveStatus } from './AutosaveStatus'

/**
 * The bar under the canvas and the right column while drawing (F2, mockup 7b): the autosave line (visible on every tab), what is graded,
 * and at the right a quiet Pause (Resume while paused) and the phase's one accent, CLOSE · DESIGN, last of its row (DESIGN-74).
 * Close still works while paused: it locks with the paused time left out.
 */
export function SessionFooter({
  mode, savedAt, paused, busy, onTogglePause, onEnd,
}: { mode: unknown; savedAt: number | null; paused: boolean; busy: boolean; onTogglePause: () => void; onEnd: () => void }) {
  return (
    <footer className="ds-footer" data-testid="session-footer">
      <span className="ds-tick" aria-hidden="true">✓</span>
      <AutosaveStatus savedAt={savedAt} />
      <span className="ds-graded" data-testid="session-graded">{gradedText(mode)}</span>
      <span className="ds-footer-acts">
        <Button variant="quiet" data-testid="session-pause" disabled={busy} onClick={onTogglePause}>{paused ? 'Resume' : 'Pause'}</Button>
        <Button variant="accent" data-testid="session-close-design" data-accent="primary" onClick={onEnd}>CLOSE · DESIGN</Button>
      </span>
    </footer>
  )
}

import { Link } from 'react-router-dom'
import type { DesignSession } from '../../data/types'
import { useSecondsNow } from '../../lib/useNow'
import type { PlanDesignRef } from '../../rules/designs'
import { clockText, remainingMs, SESSION_MS } from '../../rules/designSession'
import { Button } from '../../ui/primitives'

/** The phase as the learner reads it; `data-phase` keeps the stored word. */
const PHASE_WORD: Record<string, string> = { setup: 'Setup', drawing: 'Drawing', close: 'Close', score: 'Score', done: 'Done' }

export function SessionRail({
  item, session, onDiscard,
}: { item: PlanDesignRef; session: DesignSession | null; onDiscard: () => void }) {
  // The countdown ticks on the second boundaries of the drawing clock: earlier pauses move the anchor
  const t = useSecondsNow(session ? session.at + (session.pausedMs ?? 0) : undefined)
  const phase = session?.phase ?? 'setup'
  const paused = phase === 'drawing' && session?.pausedAt != null
  const live = phase === 'drawing' || phase === 'close' || phase === 'score'
  return (
    <header className="ds-rail" data-testid="session-rail">
      <Link to="/designs" className="ds-back">‹ Back</Link>
      <h1 className="ds-title" data-content="plan">{item.title}</h1>
      <span className={`chip diff-chip diff-${item.difficulty}`}>{item.difficulty}</span>
      <span className="ds-phase" data-testid="session-phase" data-phase={phase}>{paused ? 'Paused' : PHASE_WORD[phase]}</span>
      {phase === 'done' && session
        // UAT cu-7 P3-15: a finished session has no clock left to show; its own length stands where the countdown was
        ? <span className="ds-timer" data-testid="session-timer" aria-label="Session length">{session.minutes} min</span>
        : (
          <span className="ds-timer" data-testid="session-timer" role="timer" aria-label="Time left">
            {clockText(session ? remainingMs(session, t) : SESSION_MS)}
          </span>
        )}
      {/* Close · Design moved to the footer bar (F2); the rail keeps Discard */}
      {live && <Button variant="quiet" className="ds-discard" data-testid="session-discard" onClick={onDiscard}>Discard session</Button>}
    </header>
  )
}

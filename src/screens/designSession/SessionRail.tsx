import { Link } from 'react-router-dom'
import type { DesignSession } from '../../data/types'
import { useNow } from '../../lib/useNow'
import type { PlanDesignRef } from '../../rules/designs'
import { clockText, remainingMs, SESSION_MS } from '../../rules/designSession'
import { Button } from '../../ui/primitives'

export function SessionRail({
  item, session, onEnd, onDiscard,
}: { item: PlanDesignRef; session: DesignSession | null; onEnd: () => void; onDiscard: () => void }) {
  const t = useNow(1000)
  const phase = session?.phase ?? 'setup'
  const live = phase === 'drawing' || phase === 'close' || phase === 'score'
  return (
    <header className="ds-rail" data-testid="session-rail">
      <Link to="/designs" className="ds-back">‹ Back</Link>
      <h1 className="ds-title">{item.title}</h1>
      <span className={`chip diff-chip diff-${item.difficulty}`}>{item.difficulty}</span>
      <span className="vh" data-testid="session-phase" data-phase={phase}>{phase}</span>
      {phase === 'done' && session
        // UAT cu-7 P3-15: a finished session has no clock left to show; its own length stands where the countdown was
        ? <span className="ds-timer" data-testid="session-timer" aria-label="Session length">{session.minutes} min</span>
        : (
          <span className="ds-timer" data-testid="session-timer" role="timer" aria-label="Time left">
            {clockText(session ? remainingMs(session, t) : SESSION_MS)}
          </span>
        )}
      {phase === 'drawing' && <Button onClick={onEnd}>End drawing</Button>}
      {live && <Button variant="danger" onClick={onDiscard}>Discard session</Button>}
    </header>
  )
}

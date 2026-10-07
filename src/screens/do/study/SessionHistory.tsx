import type { Outcome, Session } from '../../../data/types'
import { fmtDayMonYear } from '../../../lib/fmtDate'
import { sessionLengthText } from '../../../rules/sessionLength'
import { Panel } from '../../../ui/primitives'
import './study.css'

/** What closed a study session that was not ended with End session (UAT cu-4 P3-11): the card's own outcome buttons. */
const ENDED_BY: Partial<Record<Outcome, string>> = { solved: 'Solved ✓', solved_help: 'Solved with help', gave_up: 'Give up' }

/**
 * A study session that has a row to show: one ended with End session (it has an end log), or one that Solved ✓, Solved with help
 * or Give up closed with it running (that row carries the plan line and the focus minutes, and no end log).
 */
export function isStudyRow(s: Session): boolean {
  return !!s.endLog || (s.outcome !== 'studied' && (!!s.goal || typeof s.focusMinutes === 'number'))
}

/** UX-18: this ticket's past study sessions (Done / Stuck on / Next step, or how a card button ended it), newest first. Nothing when there are none. */
export function SessionHistory({ sessions, ticketId }: { sessions: readonly Session[]; ticketId: string }) {
  const rows = sessions.filter(s => s.ticketId === ticketId && isStudyRow(s)).sort((a, b) => b.end - a.end)
  if (rows.length === 0) return null
  return (
    <Panel title="Earlier sessions" className="study-history" data-testid="session-history">
      <ul className="hist-list">
        {rows.map(s => (
          <li key={s.id} className="hist-row" data-testid={`session-history-${s.id}`}>
            <span className="hist-row-head" data-testid="hist-length">{fmtDayMonYear(s.end)} · {sessionLengthText(s)}</span>
            {s.goal && <p>This session I will: {s.goal}</p>}
            {s.endLog?.done && <p>Done: {s.endLog.done}</p>}
            {s.endLog?.stuckOn && <p>Stuck on: {s.endLog.stuckOn}</p>}
            {s.endLog?.nextStep && <p>Next step: {s.endLog.nextStep}</p>}
            {!s.endLog && ENDED_BY[s.outcome] && <p data-testid="hist-ended-by">Ended by: {ENDED_BY[s.outcome]}</p>}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

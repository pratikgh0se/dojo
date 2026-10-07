import { useState } from 'react'
import type { Session, Ticket } from '../../data/types'
import { fmtDayMonYear } from '../../lib/fmtDate'
import { sessionLengthText } from '../../rules/sessionLength'
import { Button, Panel } from '../../ui/primitives'

/** P1 #5: the 10 newest, then "Show all (n)". */
const CAP = 10

/** The end logs of ended study sessions (ux spec section 3, End log): Done, Stuck on, Next step. */
export function StudySessions({ sessions, tickets }: { sessions: Session[]; tickets: Ticket[] }) {
  const byId = new Map(tickets.map(t => [t.id, t]))
  const [all, setAll] = useState(false)
  const ended = sessions.filter(s => s.endLog).sort((a, b) => b.end - a.end)
  const rows = all ? ended : ended.slice(0, CAP)
  return (
    <Panel title="Study sessions" data-testid="study-sessions">
      {rows.length === 0 ? (
        <p className="empty" data-testid="no-study-sessions">No study sessions yet</p>
      ) : (
        <>
        <ul className="study-list">
          {rows.map(s => {
            const t = byId.get(s.ticketId)
            const log = s.endLog!
            return (
              <li key={s.id} className="study-row" data-testid={`study-session-${s.id}`}>
                <p className="study-row-head">
                  <span>{fmtDayMonYear(s.end)}</span> · <span>{t ? t.title : s.ticketId}</span> · <span data-testid="study-length">{sessionLengthText(s)}</span>
                </p>
                {s.goal && <p className="study-row-line">This session I will: {s.goal}</p>}
                {log.done && <p className="study-row-line">Done: {log.done}</p>}
                {log.stuckOn && <p className="study-row-line">Stuck on: {log.stuckOn}</p>}
                {log.nextStep && <p className="study-row-line">Next step: {log.nextStep}</p>}
              </li>
            )
          })}
        </ul>
        {!all && ended.length > CAP && (
          <Button className="study-more" data-testid="study-show-all" onClick={() => setAll(true)}>Show all ({ended.length})</Button>
        )}
        </>
      )}
    </Panel>
  )
}

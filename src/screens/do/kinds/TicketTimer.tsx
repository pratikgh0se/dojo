import type { ReactNode } from 'react'
import { useSettings } from '../../../data/hooks'
import type { Ticket } from '../../../data/types'
import { isReadOnly } from '../../../data/writer'
import { now } from '../../../lib/clock'
import { pad2 } from '../../../lib/dates'
import { sessionLabel } from '../../../lib/timer'
import { LONG_EVERY, phaseLabel } from '../../../rules/studySession'
import { useSecondsNow } from '../../../lib/useNow'
import { sessionMinutesOf } from '../../../rules/prefs'
import { pauseSession, requestEndSession, resumeSession } from '../../../study/controls'
import { useStudy } from '../../../study/useStudy'
import { Button } from '../../../ui/primitives'
import { Glyph } from '../../../ui/Glyph'
import { Sized } from '../../../ui/Sized'

const TOGGLE_LABELS = ['Pause', 'Resume'] as const

/**
 * The one timer of a ticket: a single countdown. At zero it says so and waits; Done or End finishes it.
 * `showReadout` false: the screen shows the reading elsewhere (the problem screen's sticky rail), so the card carries no second clock.
 * `trailing` sits in the button row beside Pause (the problem screen's End session); on a running session the caption names its
 * phase (`session-phase`: Focus, Break, Long break) with the planned minutes after it.
 * `onFocusMode` (the ticket view): a running session also shows its block pips and a "Focus mode" button that opens the same focus
 * screen as the F key. A `single` session is one block, so it shows one pip: current while it runs, filled once its time is up.
 */
export function TicketTimer({
  ticket, showReadout = true, withEnd = true, trailing, children, onFocusMode,
}: { ticket: Ticket; showReadout?: boolean; withEnd?: boolean; trailing?: ReactNode; children?: ReactNode; onFocusMode?: () => void }) {
  const study = useStudy()
  const settings = useSettings()
  const readOnly = isReadOnly()
  const mine = study && study.ticketId === ticket.id ? study : null
  // the readout drops on the session's own seconds (anchored at the phase start), so the first reading after Start is not a second late (TICKET-03)
  const t = useSecondsNow(mine?.phaseStart)
  const planned = sessionMinutesOf(settings)
  const over = !!mine?.over
  const paused = !!mine && mine.paused != null
  const reading = mine ? sessionLabel(mine, t) : ticket.status === 'done' ? '--:--' : `${pad2(planned)}:00`
  const state = !mine ? (ticket.status === 'done' ? 'finished' : 'ready') : over ? 'over' : paused ? 'paused' : 'running'
  // pips: finished focus blocks of the 4-block cycle; a single session is one block, filled once its time is up
  const pipCount = mine?.single ? 1 : LONG_EVERY
  const doneBlocks = mine ? (mine.single ? (over ? 1 : 0) : mine.blocks % LONG_EVERY) : 0
  const blockText = mine?.single ? 'one focus block' : `block ${Math.min(doneBlocks + 1, pipCount)} of ${pipCount}`
  return (
    <section className="dk-timer sr-panel" aria-label="Timer">
      <div className="dk-caprow">
        <span className="dk-cap">
          {mine ? (
            <>
              <span data-testid="session-phase" data-paused={paused ? 'true' : undefined}>{phaseLabel(mine)}</span>
              {' · '}{mine.phaseMin} min
            </>
          ) : <>Focus · {planned} min</>}
        </span>
        {mine && onFocusMode && <kbd className="sh-kbd" aria-hidden="true">F</kbd>}
      </div>
      {showReadout && <span className="dk-big" data-testid="timer-readout" role="timer">{reading}</span>}
      <span className="dk-state" data-testid="timer-state">{state}</span>
      {mine && onFocusMode && (
        <div className="dk-blocks" data-testid="ticket-blocks">
          <span className="dk-pips" aria-hidden="true">
            {Array.from({ length: pipCount }, (_, i) => (
              <span key={i} className="dk-pip" data-on={i < doneBlocks ? 'true' : 'false'} data-cur={i === doneBlocks ? 'true' : undefined} />
            ))}
          </span>
          <span className="dk-meta">{blockText}</span>
        </div>
      )}
      {over && <p className="dk-timeup" data-testid="ticket-time-up">Time is up. Keep going or finish.</p>}
      {mine && (!over || withEnd || trailing) && (
        <div className="dk-trow">
          {!over && (paused
            ? <Button disabled={readOnly} data-testid="timer-resume" onClick={() => resumeSession(now())}><Sized label="Resume" alts={TOGGLE_LABELS} /></Button>
            : <Button disabled={readOnly} data-testid="timer-pause" onClick={() => pauseSession(now())}><Sized label="Pause" alts={TOGGLE_LABELS} /></Button>)}
          {onFocusMode && <Button data-testid="timer-focus-mode" onClick={onFocusMode}><Glyph name="fullscreen" /> Focus mode</Button>}
          {withEnd && <Button variant="quiet" disabled={readOnly} data-testid="timer-end" onClick={requestEndSession}>End session</Button>}
          {trailing}
        </div>
      )}
      {children}
    </section>
  )
}

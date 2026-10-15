import type { Ticket } from '../../../data/types'
import { pad2 } from '../../../lib/dates'
import { sessionLabel } from '../../../lib/timer'
import { PHASE_LABEL, phaseLabel, type Study } from '../../../rules/studySession'
import { shownText } from '../../../rules/ticketText'
import './study.css'
import { WithFileRefs } from '../../../ui/FileRefs'

/** The card text for the session brief. */
export function briefText(t: Ticket): string {
  return shownText(t.text)
}

/** The card brief's goal (briefs Part 3), shown in the session brief when the card has one (ux Addendum 1 Q5, UX-06b). */
export function briefGoal(t: Ticket): string {
  return t.brief?.goal?.trim() ?? ''
}

/**
 * UX-06/UX-07: the brief stays beside the timer the whole session; the phase reads Focus, Break or Long break.
 * `focus` (focus mode, UAT cu-2 P3-17): as in focus-mode-1280 the brief is the title, the plan line and the goal; the card's
 * own description is left out when the brief has a goal, and stays as the one description when it has none.
 * `textShownFor`: a card whose description the screen already shows in full (the problem's Statement) is not repeated.
 */
export function Brief({ study, cards, focus = false, textShownFor }: { study: Study; cards: Ticket[]; focus?: boolean; textShownFor?: string }) {
  return (
    <div className="study-brief" data-testid="session-brief">
      {cards.map(c => (
        <div key={c.id} className="study-card">
          <h2 className="study-card-title">{c.title}</h2>
          {c.id === study.ticketId && study.goal && <p className="study-goal">This session I will: {study.goal}</p>}
          {briefGoal(c) && <p className="study-card-text study-brief-goal" data-testid="session-brief-goal">Goal: {briefGoal(c)}</p>}
          {briefText(c) && c.id !== textShownFor && !(focus && briefGoal(c)) && <p className="study-card-text"><WithFileRefs text={briefText(c)} /></p>}
        </div>
      ))}
    </div>
  )
}

const PHASE_FORMS = Object.values(PHASE_LABEL).flatMap(p => [p, `${p} · paused`])

/** `focusTimer` marks the reading as the large timer of focus mode (`focus-timer`, an inner span so it inherits the 48 px of `.study-timer`). */
export function Clock({ study, now, focusTimer = false }: { study: Study; now: number; focusTimer?: boolean }) {
  return (
    <div className="study-clock" data-phase={study.phase}>
      {/* UAT r2 J3: the phase line keeps the box of its longest form (it wraps in the narrow column), so Pause → Resume
          never pushes the clock and the buttons down */}
      <div className="study-phase-box sized">
        <div className="study-phase" data-testid="session-phase" data-paused={study.paused != null ? 'true' : undefined}>{phaseLabel(study)}{study.paused != null ? ' · paused' : ''}</div>
        {PHASE_FORMS.map(f => <div key={f} className="study-phase sized-alt" data-label={f} aria-hidden="true" />)}
      </div>
      <div className="study-timer" data-testid="session-timer" role="timer">
        {focusTimer ? <span data-testid="focus-timer">{sessionLabel(study, now)}</span> : sessionLabel(study, now)}
      </div>
      {!study.single && <div className="study-blocks" data-testid="session-blocks">Focus blocks done: {study.blocks}</div>}
    </div>
  )
}

/**
 * The running session's body on the problem screen, inside the ticket's one timer card (TicketTimer): the attempt clock and the
 * brief. The reading itself is the rail's (`timer-readout`), End sits in the card's button row, and focus mode opens with F
 * (the Attempt log is the notes box here), so this carries no clock of its own (TICKET-08, TICKET-31).
 */
export function SessionPanel({ study, cards, elapsedSec }: { study: Study; cards: Ticket[]; elapsedSec: number }) {
  return (
    <div className="study study-body" data-testid="session-panel">
      <span className="timer-elapsed" data-testid="do-timer-elapsed" data-seconds={elapsedSec}>
        This attempt {pad2(Math.floor(elapsedSec / 60))}:{pad2(elapsedSec % 60)}
      </span>
      {!study.single && <div className="study-blocks" data-testid="session-blocks">Focus blocks done: {study.blocks}</div>}
      <Brief study={study} cards={cards} textShownFor={study.ticketId} />
    </div>
  )
}

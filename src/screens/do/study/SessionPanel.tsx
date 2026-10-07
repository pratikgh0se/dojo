import type { Ticket } from '../../../data/types'
import { pad2 } from '../../../lib/dates'
import { sessionLabel } from '../../../lib/studyTimer'
import { PHASE_LABEL, phaseLabel, type Study } from '../../../rules/studySession'
import { shownText } from '../../../rules/ticketText'
import { Button, Panel } from '../../../ui/primitives'
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
 */
export function Brief({ study, cards, focus = false }: { study: Study; cards: Ticket[]; focus?: boolean }) {
  return (
    <div className="study-brief" data-testid="session-brief">
      {cards.map(c => (
        <div key={c.id} className="study-card">
          <h2 className="study-card-title">{c.title}</h2>
          {c.id === study.ticketId && study.goal && <p className="study-goal">This session I will: {study.goal}</p>}
          {briefGoal(c) && <p className="study-card-text study-brief-goal" data-testid="session-brief-goal">Goal: {briefGoal(c)}</p>}
          {briefText(c) && !(focus && briefGoal(c)) && <p className="study-card-text"><WithFileRefs text={briefText(c)} /></p>}
        </div>
      ))}
    </div>
  )
}

const PHASE_FORMS = Object.values(PHASE_LABEL).flatMap(p => [p, `${p} · paused`])

export function Clock({ study, now }: { study: Study; now: number }) {
  return (
    <div className="study-clock" data-phase={study.phase}>
      {/* UAT r2 J3: the phase line keeps the box of its longest form (it wraps in the narrow column), so Pause → Resume
          never pushes the clock and the buttons down */}
      <div className="study-phase-box sized">
        <div className="study-phase" data-testid="session-phase" data-paused={study.paused != null ? 'true' : undefined}>{phaseLabel(study)}{study.paused != null ? ' · paused' : ''}</div>
        {PHASE_FORMS.map(f => <div key={f} className="study-phase sized-alt" data-label={f} aria-hidden="true" />)}
      </div>
      <div className="study-timer" data-testid="session-timer" role="timer">{sessionLabel(study, now)}</div>
      <div className="study-blocks" data-testid="session-blocks">Focus blocks done: {study.blocks}</div>
    </div>
  )
}

export function SessionPanel({
  study, now, cards, elapsedSec, notes, onNotes, onFocus, onEnd, onChime, onResume,
}: {
  study: Study; now: number; cards: Ticket[]; elapsedSec: number; notes: string; onNotes: (v: string) => void
  onFocus: () => void; onEnd: () => void; onChime: (on: boolean) => void; onResume?: () => void
}) {
  return (
    <Panel title="Study session" className="study" data-testid="session-panel">
      <div className="study-grid">
        <Brief study={study} cards={cards} />
        <div className="study-side">
          <Clock study={study} now={now} />
          <span className="timer-elapsed" data-testid="do-timer-elapsed" data-seconds={elapsedSec}>
            This attempt {pad2(Math.floor(elapsedSec / 60))}:{pad2(elapsedSec % 60)}
          </span>
          <div className="study-actions">
            {/* UAT cu-4 P3-18: D3.6 lists no Pause (nor does the mockup): a running session is paused from its pill or the NOW tile
                (ruling 24 S1). A session paused there still has its Resume here, so it is never stuck on its own card. */}
            {study.paused != null && <Button data-testid="session-resume" onClick={onResume}>Resume</Button>}
            <Button data-testid="session-focus" onClick={onFocus}>Focus mode</Button>
            <Button variant="quiet" data-testid="session-end" onClick={onEnd}>End session</Button>
          </div>
          <label className="sr-choice">
            <input type="checkbox" checked={study.chime} onChange={e => onChime(e.target.checked)} />
            <span>Soft chime</span>
          </label>
        </div>
      </div>
      <label className="study-notes">
        Notes
        <textarea data-testid="session-notes" value={notes} onChange={e => onNotes(e.target.value)} />
      </label>
    </Panel>
  )
}

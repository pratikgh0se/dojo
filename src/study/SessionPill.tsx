import { Link } from 'react-router-dom'
import { useTicket } from '../data/hooks'
import { isPlainClick, useNavigateAfterWrites } from '../data/useNavigateAfterWrites'
import { now } from '../lib/clock'
import { sessionLabel } from '../lib/studyTimer'
import { useNow } from '../lib/useNow'
import { phaseLabel, type Study } from '../rules/studySession'
import { Sized } from '../ui/Sized'
import { Button } from '../ui/primitives'
import { pauseSession, resumeSession } from './controls'
import { useStudy } from './useStudy'
import './pill.css'

const TOGGLE_LABELS = ['Pause', 'Resume'] as const

/** What the pill says, as one sentence for assistive tech and tests: "Focus, 24:31 left, 200 · Number of Islands". */
export function pillSummary(study: Study, nowMs: number, title: string): string {
  if (study.away) return `Away from the ${phaseLabel(study).toLowerCase()}: ${title}`
  return `${phaseLabel(study)}${study.paused != null ? ' paused' : ''}, ${sessionLabel(study, nowMs)} left, ${title}`
}

function Pill({ study }: { study: Study }) {
  const t = useNow(1000)
  const go = useNavigateAfterWrites()
  const ticket = useTicket(study.ticketId)
  const title = ticket?.title ?? ''
  const paused = study.paused != null
  const to = `/do/${study.ticketId}`
  return (
    <div
      className="session-pill" data-testid="session-pill" data-phase={study.away ? 'away' : study.phase}
      data-paused={paused ? 'true' : undefined} role="group" aria-label="Study session running"
    >
      <Link
        to={to} className="session-pill-link" data-testid="session-pill-link" title={title ? `Back to ${title}` : 'Back to the card'}
        aria-label={`Study session: ${pillSummary(study, t, title)}. Back to the card.`}
        onClick={e => { if (isPlainClick(e)) { e.preventDefault(); go(to) } }}
      >
        <span className="session-pill-phase" data-testid="session-pill-phase">
          {study.away ? 'Away' : phaseLabel(study)}{paused ? ' · paused' : ''}
        </span>
        <span className="session-pill-time" data-testid="session-pill-time" role="timer">{study.away ? '--:--' : sessionLabel(study, t)}</span>
        <span className="session-pill-title" data-testid="session-pill-title">{title}</span>
      </Link>
      {!study.away && (
        paused
          ? <Button className="session-pill-toggle" data-testid="session-pill-resume" onClick={() => resumeSession(now())}><Sized label="Resume" alts={TOGGLE_LABELS} /></Button>
          : <Button className="session-pill-toggle" data-testid="session-pill-pause" onClick={() => pauseSession(now())}><Sized label="Pause" alts={TOGGLE_LABELS} /></Button>
      )}
    </div>
  )
}

/**
 * Ruling 24 S1: a running or paused study session is visible on every screen: phase · time left · card title, with
 * Pause/Resume, and a click on the pill returns to that card's Do. Nothing while no session is stored.
 */
export function SessionPill() {
  const study = useStudy()
  return study ? <Pill study={study} /> : null
}

/** The Shell's place for it: a row under the header, on every screen that has one. */
export function SessionStrip() {
  const study = useStudy()
  if (!study) return null
  return <div className="session-strip" data-testid="session-strip"><Pill study={study} /></div>
}

/**
 * Do and the design session have no header: the running session shows as a pill under their rail. That includes the session's own
 * card, where it holds Pause and Resume (ruling 26 D3.6 moved them out of the session panel, so the pill must be there too:
 * UAT cu-2p P3-6).
 */
export function SessionDock() {
  const study = useStudy()
  if (!study) return null
  return <div className="session-dock" data-testid="session-dock"><Pill study={study} /></div>
}

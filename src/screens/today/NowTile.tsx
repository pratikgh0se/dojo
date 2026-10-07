import { Link } from 'react-router-dom'
import { tipProps } from '../../ui/Tip'
import { now } from '../../lib/clock'
import { sessionLabel } from '../../lib/studyTimer'
import { clockLabel, drainBlocks } from '../../lib/timer'
import { useNow } from '../../lib/useNow'
import type { NowTileModel } from '../../rules/nowTile'
import { phaseEnd, phaseLabel, remainingMs, type Study } from '../../rules/studySession'
import { pauseSession, requestEndSession, resumeSession } from '../../study/controls'
import { Sized } from '../../ui/Sized'
import type { SparTimer } from '../../ui/useSparTimer'

const TOGGLE_LABELS = ['Pause', 'Resume'] as const

/**
 * Ruling 24 S1: a running study session is the tile's running state (its phase readout, Pause/Resume and End),
 * never the idle Spar buttons. End asks for the End session dialog; the session itself ends, not a timer under it.
 */
function SessionNow({ study, card }: { study: Study; card: string | null }) {
  const t = useNow(1000)
  const paused = study.paused != null
  const blocks = drainBlocks(remainingMs(study, t), study.phaseMin * 60_000)
  return (
    <>
      <div className="now-timer" data-testid="now-session" data-phase={study.phase}>
        <div className="now-blocks" data-testid="now-blocks" aria-hidden="true">
          {blocks.map((b, i) => <i key={i} className="now-block" data-state={b} />)}
        </div>
        <div className="now-readout" data-testid="now-readout" data-paused={paused ? 'true' : undefined} role="timer">{sessionLabel(study, t)}</div>
        {paused
          ? <button type="button" className="sr-btn now-session-toggle" data-testid="now-session-resume" onClick={() => resumeSession(now())}><Sized label="Resume" alts={TOGGLE_LABELS} /></button>
          : <button type="button" className="sr-btn now-session-toggle" data-testid="now-session-pause" onClick={() => pauseSession(now())}><Sized label="Pause" alts={TOGGLE_LABELS} /></button>}
        <button
          type="button" className="sr-btn sr-btn-quiet now-retreat" data-testid="now-session-end" onClick={requestEndSession}
          aria-label="End session: save it and stop" title="End the study session"
        >
          End session
        </button>
      </div>
      <span className="now-timer-sub" data-testid="now-timer-sub">
        {card ? `${card} · ` : ''}{paused ? `${phaseLabel(study)} · paused` : `${phaseLabel(study)} · of ${study.phaseMin} min · ends ${clockLabel(phaseEnd(study))}`}
      </span>
    </>
  )
}

/** README-dashboard "Today" §1 / prototype NOW tile. `spar` is Today's (its space key drives the same timer). */
export function NowTile({ model, spar, session = null, sessionCard = null }: {
  model: NowTileModel; spar: SparTimer; session?: Study | null
  /** the title of the session's card when it is not the tile's own card */
  sessionCard?: string | null
}) {
  const id = model.primaryId
  const timing = spar.running || spar.paused || session !== null
  return (
    <section className="sr-hero now-tile" data-tone={model.tone} data-phase={model.phase} aria-label="Now">
      <div className="now-left">
        <div className="now-eyebrow-row">
          <p className="now-eyebrow" data-testid="now-eyebrow">{model.eyebrow}</p>
          {model.time && <span className="now-time" data-testid="now-time">{model.time}</span>}
        </div>
        <h1 className="now-headline" data-testid="now-headline">{model.verb}</h1>
        <p className="now-text" data-testid="now-text">{model.sentence}</p>
      </div>
      {id && (
        <div className="now-right">
          {session ? <SessionNow study={session} card={sessionCard} /> : timing && (
            <>
              <div className="now-timer">
                <div className="now-blocks" data-testid="now-blocks" aria-hidden="true">
                  {spar.blocks.map((b, i) => <i key={i} className="now-block" data-state={b} />)}
                </div>
                <div className="now-readout" data-testid="now-readout" data-paused={spar.paused ? 'true' : undefined} role="timer">{spar.mmss}</div>
                <button type="button" className="sr-btn sr-btn-quiet now-retreat" onClick={spar.retreat} aria-label="Retreat: stop the timer" {...tipProps('Stop the timer', 'right')}>Retreat</button>
              </div>
              <span className="now-timer-sub" data-testid="now-timer-sub">
                {spar.paused ? `of ${spar.min} min · paused` : `of ${spar.min} min · ends ${spar.endsAt}`}
              </span>
            </>
          )}
          <div className="now-actions">
            {!timing && (
              <>
                <button type="button" className="sr-btn now-btn" data-testid="spar-50" onClick={() => spar.start(50)}>Spar · 50</button>
                <button type="button" className="sr-btn now-btn" data-testid="spar-25" onClick={() => spar.start(25)}>Spar · 25</button>
              </>
            )}
            {model.link && (
              <a
                href={model.link.url} target="_blank" rel="noopener noreferrer" title={model.link.label}
                className="sr-btn now-btn now-open" data-testid="open-link"
              >
                <span className="now-open-label">Open · {model.link.short} ↗</span>
              </a>
            )}
            {/* Ruling Q1 (spec D4): PLATFORM's Start ▸ is the accent primary, in the prototype's accent slot. */}
            <Link to={`/do/${id}`} className="sr-btn sr-btn-accent now-btn now-start" data-testid="start-button">Start ▸</Link>
          </div>
        </div>
      )}
    </section>
  )
}

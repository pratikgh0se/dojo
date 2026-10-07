import { useEffect, useId, useRef } from 'react'
import { Link } from 'react-router-dom'
import { twoUpPartner, walkDef, type Pattern } from '../../content/atlas'
import type { PatternCoverage } from '../../rules/approachCoverage'
import type { PatternState } from '../../rules/atlasProgress'
import type { TaggedProblem } from '../../rules/atlasRows'
import { AlgoPlayer } from '../../ui/algo/AlgoPlayer'
import { TwoUp } from '../../ui/algo/TwoUp'
import { Button } from '../../ui/primitives'
import { STATE_TEXT } from './AtlasMatrix'

export type Opened = { mode: 'play' | 'predict' | 'input'; key: string } | { mode: 'twoup'; key: string; right: string }

/**
 * The pattern panel (labs contract §5.5): coverage, walkthroughs with Play / Predict / Two-up / Own input,
 * Trace my own input, approach coverage, the plan problems tagged with the row, and the last picture.
 * One player (or one two-up) at a time, below the list.
 */
export function AtlasDetail({
  pattern, state, coverage, problems, opened, onOpen, onClose,
}: {
  pattern: Pattern
  state: PatternState
  coverage: PatternCoverage
  problems: TaggedProblem[]
  opened: Opened | null
  onOpen: (o: Opened | null) => void
  onClose: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const [fixedId, traceId, solvedId] = [useId(), useId(), useId()]
  const firstRunnable = pattern.walkthroughs.find(k => walkDef(k)?.input)

  // Opening the panel moves focus to its heading (§9).
  useEffect(() => {
    heading.current?.focus()
  }, [pattern.slug])

  const open = (o: Opened, button: HTMLElement) => {
    opener.current = button
    onOpen(o)
  }
  const closePlayer = () => {
    onOpen(null)
    opener.current?.focus()
  }

  return (
    <aside className="sr-panel atlas-detail" aria-label={`Pattern: ${pattern.label}`} data-testid="atlas-detail">
      <div className="atlas-detail-head">
        <h2 className="sr-panel-title" ref={heading} tabIndex={-1}>{pattern.label}</h2>
        <Button variant="quiet" onClick={onClose}>Close</Button>
      </div>
      <p className="atlas-line">{STATE_TEXT[state]}</p>
      <p className="atlas-line" data-testid="atlas-coverage">{`Coverage: ${pattern.status} · ${pattern.how}`}</p>

      <h3 className="sub-title">Walkthroughs</h3>
      {pattern.walkthroughs.length === 0 ? (
        <p className="hint">No walkthrough yet</p>
      ) : (
        <ul className="atlas-walks" aria-label="Walkthroughs">
          {pattern.walkthroughs.map(key => {
            const w = walkDef(key)!
            const partner = twoUpPartner(key, pattern.slug)
            return (
              <li key={key} className="atlas-walk">
                <span className="aw-title">{w.title}</span>
                <span className="aw-cx">{w.complexity}</span>
                <span className="aw-actions">
                  <Button onClick={e => open({ mode: 'play', key }, e.currentTarget)}>Play</Button>
                  <Button onClick={e => open({ mode: 'predict', key }, e.currentTarget)}>Predict</Button>
                  <Button disabled={!partner} onClick={e => partner && open({ mode: 'twoup', key, right: partner }, e.currentTarget)}>Two-up</Button>
                  <Button disabled={!w.input} aria-describedby={w.input ? undefined : fixedId} onClick={e => open({ mode: 'input', key }, e.currentTarget)}>
                    Own input
                  </Button>
                </span>
              </li>
            )
          })}
        </ul>
      )}
      <span id={fixedId} hidden>Fixed example: no own input.</span>
      <p>
        <Button
          disabled={!firstRunnable}
          aria-describedby={firstRunnable ? undefined : traceId}
          onClick={e => firstRunnable && open({ mode: 'input', key: firstRunnable }, e.currentTarget)}
        >
          Trace my own input
        </Button>
        <span id={traceId} hidden>No runnable walkthrough for this pattern.</span>
      </p>

      {opened && opened.mode === 'twoup' ? (
        <TwoUp key={`${opened.key}-${opened.right}`} left={opened.key} right={opened.right} onRight={r => onOpen({ ...opened, right: r })} onClose={closePlayer} />
      ) : opened ? (
        <AlgoPlayer
          key={`${opened.mode}-${opened.key}`}
          walkKey={opened.key}
          autoplay={opened.mode === 'play'}
          startPredict={opened.mode === 'predict'}
          openInput={opened.mode === 'input'}
          onClose={closePlayer}
        />
      ) : null}

      <p className="atlas-line" data-testid="atlas-approach-coverage">{`Reached for ${coverage.used} · best answer ${coverage.best}`}</p>

      <h3 className="sub-title">Problems</h3>
      {problems.length === 0 ? (
        <p className="hint">No plan problems tagged yet.</p>
      ) : (
        <ul className="atlas-problems" aria-label="Problems">
          {problems.map(t => (
            <li key={t.id}>
              <span className="sr-cube" data-on={t.solved ? 'true' : 'false'} aria-hidden="true" />
              <Link to={`/do/${t.id}`} aria-describedby={t.solved ? solvedId : undefined}>{`${t.num} ${t.name}`}</Link>
              <span className="ap-sprint">S{t.sprint}</span>
            </li>
          ))}
        </ul>
      )}
      <span id={solvedId} hidden>solved</span>

      <h3 className="sub-title">Last picture</h3>
      <p className="hint" data-testid="atlas-last-picture">No picture generated yet.</p>
    </aside>
  )
}

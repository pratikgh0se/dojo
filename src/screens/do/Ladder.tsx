import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { DiagramJson, SolutionOutput, SrAlgoJson } from '../../ai/types'
import type { Link as PlanLink } from '../../data/types'
import { HINT_UNLOCK_SECONDS, spentText, whyText, type RungName, type RungView } from '../../rules/ladderView'
import { PSEUDOCODE_MAX_LINES } from '../../rules/rungContent'
import { AiError, AiLoader, type AiFailure } from '../../ui/ai/AiStates'
import { Button } from '../../ui/primitives'
import { PicturePlayer } from './PicturePlayer'
import './ladder.css'

export type PictureBody =
  | { kind: 'dsa'; steps: number; caption: string; json: SrAlgoJson }
  | { kind: 'design'; nodes: number; links: number; caption: string; labels: string[]; json: DiagramJson }
  | { kind: 'links'; links: PlanLink[]; empty: string }

export interface LadderContent {
  hints: string[]
  /** cost of the second hint while it is still available, else null */
  hintMoreCost: number | null
  picture: PictureBody | null
  video: { links: PlanLink[]; empty: string } | null
  solution: SolutionOutput | null
}

export interface LadderProps {
  /** display title (problem name without its number) */
  title: string
  rungs: RungView[]
  spent: number
  spentByRung: Record<RungName, number>
  announce: string
  busy: RungName | null
  errors: Partial<Record<RungName, AiFailure>>
  content: LadderContent
  quizResult: string | null
  onOpen: (name: RungName) => void
  onMoreHint: () => void
  onRetry: (name: RungName) => void
  onCheckQuiz: (answers: string[]) => void
  /** seconds this attempt's timer has run, for the Hint's "n min to go" */
  elapsedSec?: number
}

/** cu-r2 A2#6: what a click on a locked (or unavailable) rung says, since the button itself cannot act */
export function lockedReason(name: RungName, state: RungView['state'], elapsedSec = 0): string {
  if (state === 'na') return name === 'solution' ? 'There is no Solution for a task card.' : 'This help is not available for this card.'
  switch (name) {
    case 'hint': {
      const left = Math.ceil((HINT_UNLOCK_SECONDS - elapsedSec) / 60)
      return left > 0 ? `The Hint opens after 10 minutes on this attempt (${left} min to go).` : 'The Hint opens after 10 minutes on this attempt.'
    }
    case 'picture': return 'The Picture opens once you have opened a Hint.'
    case 'video': return 'The Video opens once you have opened the Picture.'
    case 'solution': return 'The Solution opens after you give up.'
    default: return 'This rung is always open.'
  }
}

function LinkList({ links, label, testId }: { links: PlanLink[]; label: string; testId?: string }) {
  return (
    <ul className="rung-links" aria-label={label} {...(testId ? { 'data-testid': testId } : {})}>
      {links.map(l => (
        <li key={l.url}><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a></li>
      ))}
    </ul>
  )
}

function Quiz({ quiz, result, onCheck }: { quiz: { q: string; a: string }[]; result: string | null; onCheck: (a: string[]) => void }) {
  const [answers, setAnswers] = useState(() => quiz.map(() => ''))
  return (
    <div className="ladder-quiz" role="group" aria-label="Check your understanding" data-testid="ladder-quiz">
      {quiz.map((item, i) => (
        <label key={i} className="quiz-item">
          <span>{item.q}</span>
          <input
            type="text" data-testid={`ladder-quiz-answer-${i + 1}`} value={answers[i]}
            onChange={e => setAnswers(a => a.map((x, j) => (j === i ? e.target.value : x)))}
          />
        </label>
      ))}
      <Button data-testid="ladder-quiz-check" onClick={() => onCheck(answers)}>Check answers</Button>
      {result && <p className="quiz-result" role="status" data-testid="ladder-quiz-result">{result}</p>}
    </div>
  )
}

function Picture({ body, title }: { body: PictureBody; title: string }) {
  if (body.kind === 'links') return body.links.length ? <LinkList links={body.links} label="Watch links" /> : <p className="rung-note">{body.empty}</p>
  const attrs = body.kind === 'dsa' ? { 'data-steps': body.steps } : { 'data-nodes': body.nodes, 'data-links': body.links }
  return (
    <figure className="picture-player" aria-label={`Picture for ${title}`} data-testid="ladder-picture-player" data-source="model" {...attrs}>
      <figcaption>{body.caption}</figcaption>
      <PicturePlayer picture={body.kind === 'dsa' ? { kind: 'dsa', json: body.json } : { kind: 'design', json: body.json }} title={title} />
    </figure>
  )
}

function Body({ r, p }: { r: RungView; p: LadderProps }) {
  const c = p.content
  let content: ReactNode = null
  if (r.state === 'open') {
    switch (r.name) {
      case 'attempt':
        content = <p className="rung-note" data-testid="ladder-why-attempt">The timer, the links and your log. Always open.</p>
        break
      case 'hint':
        content = (
          <>
            {c.hints.map((h, i) => <p key={i} className="rung-hint" data-testid={`ladder-hint-${i + 1}`}>{h}</p>)}
            {c.hintMoreCost !== null && p.busy === null && (
              <Button data-testid="ladder-hint-more" onClick={p.onMoreHint}>{`Second hint, costs ${c.hintMoreCost} xp`}</Button>
            )}
          </>
        )
        break
      case 'picture':
        content = c.picture ? <Picture body={c.picture} title={p.title} /> : null
        break
      case 'video':
        content = c.video ? (c.video.links.length ? <LinkList links={c.video.links} label="Video links" testId="ladder-video-links" /> : <p className="rung-note">{c.video.empty}</p>) : null
        break
      case 'solution':
        content = c.solution ? (
          <>
            <section className="ladder-solution" aria-label="Solution" data-testid="ladder-solution">
              <p className="sol-approach">{c.solution.approach}</p>
              <ol className="sol-pseudo" data-testid="ladder-solution-pseudocode">
                {c.solution.pseudocode.slice(0, PSEUDOCODE_MAX_LINES).map((line, i) => <li key={i}>{line}</li>)}
              </ol>
              <p className="rung-note">{c.solution.complexity}</p>
            </section>
            <Quiz quiz={c.solution.quiz} result={p.quizResult} onCheck={p.onCheckQuiz} />
          </>
        ) : null
        break
    }
  }
  const err = p.errors[r.name]
  return (
    <>
      {content}
      {p.busy === r.name ? <AiLoader /> : err ? <AiError failure={err} onRetry={() => p.onRetry(r.name)} /> : null}
    </>
  )
}

/** PLATFORM "Do" → right column: the five-rung help ladder (C-LADDER §3.2). */
export function Ladder(p: LadderProps) {
  const [why, setWhy] = useState<RungName | null>(null)
  return (
    // "help-ladder", not "ladder": screens/designs.css already owns the bare .ladder class
    // (an unrelated skill-ladder grid) — colliding class names caused a real, visible layout
    // bug (the rung panels rendered as squeezed 6-column strips) until this was renamed.
    <section className="help-ladder" aria-label="Help ladder" data-testid="ladder">
      <header className="ladder-head">
        <h2 className="sr-panel-title">Help ladder</h2>
        <span className="ladder-spent" data-testid="ladder-spent" data-xp={p.spent}>{spentText(p.spent)}</span>
      </header>
      <p className="ladder-announcer vh" role="status" aria-live="polite" data-testid="ladder-announcer">{p.announce}</p>
      {p.rungs.map(r => {
        const showBody = r.state === 'open' || p.busy === r.name || p.errors[r.name] !== undefined
        const paid = p.spentByRung[r.name]
        return (
          <div
            key={r.name} className={`sr-panel rung rung-${r.state}`} data-testid={`ladder-rung-${r.name}`} data-state={r.state}
            {...(r.cost === null ? {} : { 'data-cost': r.cost })}
            onClick={r.state === 'locked' || r.state === 'na' ? () => setWhy(r.name) : undefined}
          >
            <button
              type="button" className="rung-btn" data-testid={`ladder-open-${r.name}`} aria-label={r.buttonLabel}
              // Once open, this button must stay focusable: a real `disabled` on the very button
              // that just received focus (from the click that opened it) yanks focus to <body>,
              // losing a keyboard user's place. aria-disabled communicates the same "opened,
              // nothing to do here" state to assistive tech while keeping it in the tab order -
              // openRung's own state check (r.state === 'unlocked') already makes a click on an
              // open rung a safe no-op, so there's no risk of a double-open.
              disabled={(r.state !== 'unlocked' && r.state !== 'open') || p.busy !== null}
              aria-disabled={r.state === 'open' || undefined}
              onClick={() => p.onOpen(r.name)}
            >
              <span className="rung-num" aria-hidden="true">{r.rung}</span>
              <span className="rung-name" aria-hidden="true">{r.label}</span>
              <span className="rung-cube" data-testid={`ladder-cost-${r.name}`} title={r.cost === null ? 'Not available' : `Costs ${r.cost} xp`} aria-hidden="true">{r.cube}</span>
            </button>
            {why === r.name && (r.state === 'locked' || r.state === 'na') && (
              <p className="rung-note" role="status" data-testid={`ladder-locked-why-${r.name}`}>{lockedReason(r.name, r.state, p.elapsedSec)}</p>
            )}
            {showBody && <div className="rung-body"><Body r={r} p={p} /></div>}
            {r.state === 'open' && paid > 0 && (
              <p className="rung-why" data-testid={`ladder-why-${r.name}`}>
                {whyText(r.label, paid)}
                {/* Visible link text is CSS generated content so the line's text is exactly the sentence (C-LADDER §3.2). */}
                <Link to="/progress#help-ladder" className="rung-why-link" aria-label="See the honesty chart" />
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}

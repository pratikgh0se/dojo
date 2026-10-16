import { Fragment, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDb } from '../app/providers'
import { useDueReviews } from '../app/useDueReviews'
import { applyGrade } from '../data/redoGrade'
import { safeWrite } from '../data/safeWrite'
import { isReadOnly } from '../data/writer'
import { now } from '../lib/clock'
import { dueLabel, gradeHint, queueMeta, type Grade, type ReviewCard } from '../rules/reviewQueue'
import { KIND_LABEL, LANE_LABEL } from '../rules/ticketMeta'
import { Loading } from '../ui/Loading'
import { Button, useToast } from '../ui/primitives'
import './review.css'

const GRADES: { id: 'missed' | 'close' | 'got'; grade: Grade; label: string }[] = [
  { id: 'missed', grade: 'missed', label: 'Missed it' }, { id: 'close', grade: 'close', label: 'Close' }, { id: 'got', grade: 'got', label: 'Got it' },
]

/** The hook names of a card in Review and in the Floor session (rituals.md "Required hooks"): written out so the contract check can read them. */
const GRADE_KEY = { missed: 'gradeMissedTestId', close: 'gradeCloseTestId', got: 'gradeGotTestId' } as const
const IDS = {
  review: {
    cardTestId: 'review-card', kindTestId: 'review-card-kind', titleTestId: 'review-card-title', questionTestId: 'review-card-question', answerTestId: 'review-answer', hintTestId: 'review-hint',
    skipTestId: 'review-skip', revealTestId: 'review-reveal', yoursTestId: 'review-your-answer', storedTestId: 'review-stored-answer', redoTestId: 'review-redo',
    gradeMissedTestId: 'review-grade-missed', gradeCloseTestId: 'review-grade-close', gradeGotTestId: 'review-grade-got',
  },
  floor: {
    cardTestId: 'floor-card', kindTestId: 'floor-card-kind', titleTestId: 'floor-card-title', questionTestId: 'floor-card-question', answerTestId: 'floor-answer', hintTestId: 'floor-hint',
    skipTestId: 'floor-skip', revealTestId: 'floor-reveal', yoursTestId: 'floor-your-answer', storedTestId: 'floor-stored-answer', redoTestId: 'floor-redo',
    gradeMissedTestId: 'floor-grade-missed', gradeCloseTestId: 'floor-grade-close', gradeGotTestId: 'floor-grade-got',
  },
} as const

export function Review() {
  const cards = useDueReviews()
  // Ids sent to the back of the queue for this visit (Missed it, Skip for today). Nothing is written for them.
  const [behind, setBehind] = useState<string[]>([])
  const queue = useMemo(() => {
    if (!cards) return []
    const later = behind.filter(id => cards.some(c => c.id === id))
    return [...cards.filter(c => !later.includes(c.id)), ...later.map(id => cards.find(c => c.id === id)!)]
  }, [cards, behind])
  if (!cards) return <Loading />
  if (queue.length === 0) {
    return (
      <div className="rv">
        <div className="rv-empty" data-testid="review-empty" data-empty="true">
          <p>Nothing is due.</p>
          <Link className="sr-btn" to="/" data-testid="review-empty-action">Go to Today</Link>
        </div>
      </div>
    )
  }
  const meta = queueMeta(queue)
  const head = queue[0]
  return (
    <div className="rv">
      <CardView key={head.id} card={head} total={queue.length} onBehind={() => setBehind(b => [...b.filter(x => x !== head.id), head.id])} />
      <aside className="rv-queue sr-panel" data-testid="review-queue" aria-label="Queue">
        <span className="rv-cap">Queue</span>
        <div className="rv-qline">
          <div className="rv-count"><span className="rv-big" data-testid="review-count" data-count={meta.count}>{meta.count}</span><span>due</span></div>
          <span className="rv-meta" data-testid="review-oldest">{meta.oldest}</span>
        </div>
        <span className="rv-meta" data-testid="review-split">{meta.split}</span>
      </aside>
    </div>
  )
}

/** One Review card. The Floor session (W5) reuses it with the prefix `floor`: same answer-first flow, no lane tag and no age, its own position line. */
export function CardView({ card, total, onBehind, prefix = 'review' }: { card: ReviewCard; total: number; onBehind: () => void; prefix?: 'review' | 'floor' }) {
  const T = IDS[prefix]
  const review = prefix === 'review'
  const d = useDb()
  const nav = useNavigate()
  const toast = useToast()
  const readOnly = isReadOnly()
  const [answer, setAnswer] = useState('')
  const [revealed, setRevealed] = useState(false)
  const grading = useRef(false)
  const check = card.kind === 'check'

  // Missed it and Skip write nothing; they send the card behind the others. With a queue of one it is the same card again, so it
  // goes back to the answer-first state (nothing typed, nothing revealed) and the click visibly did something.
  function later() { setRevealed(false); setAnswer(''); onBehind() }

  async function grade(g: Grade) {
    if (g === 'missed') { later(); return }
    // a second click before the first write lands must not move the redo up twice
    if (isReadOnly() || grading.current) return
    grading.current = true
    try {
      await safeWrite(() => applyGrade(d, card.redoId, g, now()), m => toast(m, 'danger'))
    } catch {
      toast('That grade was not saved. Try again.', 'danger')
    } finally {
      grading.current = false
    }
  }

  return (
    <section className="rv-card sr-panel" data-testid={T.cardTestId} data-kind={card.kind} data-ticket-id={card.ticketId}>
      <div className="rv-head">
        {review && <span className="rv-cap" data-testid="review-position">Card 1 of {total}</span>}
        {review && <span className="rv-lane" data-lane={card.lane} data-testid="review-card-lane"><span>{LANE_LABEL[card.lane]}</span></span>}
        <span className="rv-meta" data-testid={T.kindTestId}>{card.kindLabel ?? KIND_LABEL[card.ticketKind]}</span>
      </div>
      <div className="rv-what">
        <span className="rv-name" data-testid={T.titleTestId} data-content="plan">{card.title}</span>
        {/* RIT-04: "due today", "due 1 day ago", "due <n> days ago"; the Floor shows no age (RIT-43) */}
        {review && <span className="rv-meta" data-testid="review-card-due">{dueLabel(card.ageDays)}</span>}
      </div>
      <p className="rv-q" data-testid={T.questionTestId} {...(check ? { 'data-content': 'plan' } : {})}>{card.prompt}</p>

      {check && !revealed && (
        <>
          <label className="rv-field">
            <span className="rv-cap">Your answer</span>
            <textarea data-testid={T.answerTestId} data-content="learner" value={answer} disabled={readOnly} onChange={e => setAnswer(e.target.value)} rows={5} />
          </label>
          <span className="rv-meta" id="review-reveal-hint" data-testid={T.hintTestId}>
            {answer.trim() ? 'Ready when you are. A rough answer is fine.' : 'Write an answer first, then reveal. A rough answer is fine.'}
          </span>
          <div className="rv-actions">
            <Button variant="quiet" data-testid={T.skipTestId} disabled={!review && readOnly} onClick={later}>Skip for today</Button>
            <Button variant="accent" data-accent="primary" data-testid={T.revealTestId} aria-describedby="review-reveal-hint" disabled={!answer.trim()} onClick={() => setRevealed(true)}>REVEAL · ANSWER</Button>
          </div>
        </>
      )}

      {check && revealed && (
        <>
          <div className="rv-ans">
            <span className="rv-cap">Your answer</span>
            <blockquote data-testid={T.yoursTestId} data-content="learner">{answer}</blockquote>
          </div>
          <div className="rv-ans">
            <span className="rv-cap rv-ok">Stored answer</span>
            {card.stored
              ? <blockquote data-testid={T.storedTestId} data-content="plan">{card.stored}</blockquote>
              : <blockquote data-testid={T.storedTestId}>This ticket has no stored answer yet.</blockquote>}
          </div>
          <div className="rv-actions rv-grades">
            {GRADES.map(g => (
              <Fragment key={g.id}>
                {/* the name stays the grade's own words; the interval is drawn beside it and read out as the description */}
                <Button
                  className="rv-grade" data-testid={T[GRADE_KEY[g.id]]} data-hint={gradeHint(card.stage, g.grade)} aria-label={g.label}
                  aria-describedby={`review-hint-${g.id}`} disabled={readOnly} onClick={() => void grade(g.grade)}
                >
                  {g.label}
                </Button>
                <span className="vh" id={`review-hint-${g.id}`}>{g.grade === 'missed' ? 'Comes back later in this visit' : g.grade === 'got' && card.stage === 2 ? 'Done, no more reviews' : `Due again in ${gradeHint(card.stage, g.grade)}`}</span>
              </Fragment>
            ))}
          </div>
        </>
      )}

      {!check && (
        <div className="rv-actions">
          <Button variant="quiet" data-testid={T.skipTestId} disabled={!review && readOnly} onClick={later}>Skip for today</Button>
          <Button variant="accent" data-accent="primary" data-testid={T.redoTestId} disabled={readOnly} onClick={() => nav(card.to)}>{card.redoLabel}</Button>
        </div>
      )}
    </section>
  )
}

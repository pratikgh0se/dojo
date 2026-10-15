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

function CardView({ card, total, onBehind }: { card: ReviewCard; total: number; onBehind: () => void }) {
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
    <section className="rv-card sr-panel" data-testid="review-card" data-kind={card.kind} data-ticket-id={card.ticketId}>
      <div className="rv-head">
        <span className="rv-cap" data-testid="review-position">Card 1 of {total}</span>
        <span className="rv-lane" data-lane={card.lane} data-testid="review-card-lane"><span>{LANE_LABEL[card.lane]}</span></span>
        <span className="rv-meta" data-testid="review-card-kind">{card.kindLabel ?? KIND_LABEL[card.ticketKind]}</span>
      </div>
      <div className="rv-what">
        <span className="rv-name" data-testid="review-card-title" data-content="plan">{card.title}</span>
        <span className="rv-meta">{dueLabel(card.ageDays)}</span>
      </div>
      <p className="rv-q" data-testid="review-card-question" {...(check ? { 'data-content': 'plan' } : {})}>{card.prompt}</p>

      {check && !revealed && (
        <>
          <label className="rv-field">
            <span className="rv-cap">Your answer</span>
            <textarea data-testid="review-answer" data-content="learner" value={answer} disabled={readOnly} onChange={e => setAnswer(e.target.value)} rows={5} />
          </label>
          <span className="rv-meta" id="review-reveal-hint" data-testid="review-hint">
            {answer.trim() ? 'Ready when you are. A rough answer is fine.' : 'Write an answer first, then reveal. A rough answer is fine.'}
          </span>
          <div className="rv-actions">
            <Button variant="quiet" data-testid="review-skip" onClick={later}>Skip for today</Button>
            <Button variant="accent" data-accent="primary" data-testid="review-reveal" aria-describedby="review-reveal-hint" disabled={!answer.trim()} onClick={() => setRevealed(true)}>REVEAL · ANSWER</Button>
          </div>
        </>
      )}

      {check && revealed && (
        <>
          <div className="rv-ans">
            <span className="rv-cap">Your answer</span>
            <blockquote data-testid="review-your-answer" data-content="learner">{answer}</blockquote>
          </div>
          <div className="rv-ans">
            <span className="rv-cap rv-ok">Stored answer</span>
            {card.stored
              ? <blockquote data-testid="review-stored-answer" data-content="plan">{card.stored}</blockquote>
              : <blockquote data-testid="review-stored-answer">This ticket has no stored answer yet.</blockquote>}
          </div>
          <div className="rv-actions rv-grades">
            {GRADES.map(g => (
              <Fragment key={g.id}>
                {/* the name stays the grade's own words; the interval is drawn beside it and read out as the description */}
                <Button
                  className="rv-grade" data-testid={`review-grade-${g.id}`} data-hint={gradeHint(card.stage, g.grade)} aria-label={g.label}
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
          <Button variant="quiet" data-testid="review-skip" onClick={later}>Skip for today</Button>
          <Button variant="accent" data-accent="primary" data-testid="review-redo" disabled={readOnly} onClick={() => nav(card.to)}>{card.redoLabel}</Button>
        </div>
      )}
    </section>
  )
}

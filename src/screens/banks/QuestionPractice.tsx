import { useEffect, useRef, useState } from 'react'
import { useDb } from '../../app/providers'
import { addQuestionToReview, deleteExtraQuestion, gradeQuestion } from '../../data/bankQuestionActions'
import { safeWrite } from '../../data/safeWrite'
import type { BankGrade, Redo } from '../../data/types'
import { now } from '../../lib/clock'
import { GRADE_LABEL, GRADES, offersReview, openBankRedo, TYPE_LABEL, type Question } from '../../rules/bankQuestions'
import { Button, useToast } from '../../ui/primitives'

const isUrl = (s: string): boolean => /^https?:\/\//i.test(s)

/**
 * BANK-08 to BANK-14, BANK-23, BANK-24: one question, answer first. Type an answer, reveal the model answer and the checklist, grade
 * yourself. Typing, revealing and ticking write nothing; only a grade, Add to Review and Delete do.
 */
export function QuestionPractice({ q, topic, redos, readOnly, onDeleted }: {
  q: Question; topic: string; redos: readonly Redo[]; readOnly: boolean; onDeleted: () => void
}) {
  const d = useDb()
  const toast = useToast()
  const [answer, setAnswer] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set())
  const [grade, setGrade] = useState<BankGrade | null>(null)
  const [confirming, setConfirming] = useState(false)
  const ref = useRef<HTMLElement>(null)
  // opened by a click on a row: bring it into view (on a phone it sits above the list, under the filters)
  useEffect(() => { ref.current?.scrollIntoView?.({ block: 'start' }) }, [])
  const added = openBankRedo(redos, q.id) !== undefined

  const tick = (n: number, on: boolean) => setTicked(s => { const x = new Set(s); if (on) x.add(n); else x.delete(n); return x })

  async function doGrade(g: BankGrade) {
    if (readOnly) return
    setGrade(g)
    await safeWrite(() => gradeQuestion(d, q, g, now()), m => toast(m, 'danger'))
  }
  async function addReview() {
    if (readOnly) return
    const r = await safeWrite(() => addQuestionToReview(d, q, topic, now()), m => toast(m, 'danger'))
    if (r) toast('Added to Review.')
  }
  async function remove() {
    if (readOnly) return
    const ok = await safeWrite(() => deleteExtraQuestion(d, q.id), m => toast(m, 'danger'))
    if (ok) { toast('Question deleted.'); onDeleted() }
  }

  const plan = q.aiMade ? {} : { 'data-content': 'plan' }

  return (
    <section ref={ref} className="bq-practice sr-panel" data-testid="banks-q-practice" data-qid={q.id} aria-label="Practise this question">
      <div className="bq-practice-head">
        <span className="chip">{TYPE_LABEL[q.type]}</span>
        <span className="chip">Level {q.difficulty}</span>
        <span className="banks-meta" data-testid="banks-q-node">{topic}</span>
        {q.aiMade && <span className="chip bq-aimade">AI-made</span>}
      </div>
      <p className="bq-question" data-testid="banks-q-question" {...plan}>{q.question}</p>

      <label className="bq-field">
        <span className="bq-cap">Your answer</span>
        <textarea
          data-testid="banks-q-answer" data-content="learner" rows={6} value={answer} readOnly={revealed}
          onChange={e => setAnswer(e.target.value)}
        />
      </label>

      {!revealed ? (
        <div className="bq-actions">
          <Button
            variant="accent" data-accent="primary" data-testid="banks-q-reveal" disabled={!answer.trim()}
            aria-describedby="banks-q-reveal-hint" onClick={() => setRevealed(true)}
          >
            REVEAL · ANSWER
          </Button>
          <span className="banks-meta" id="banks-q-reveal-hint">{answer.trim() ? 'Ready when you are. A rough answer is fine.' : 'Type an answer first, then reveal.'}</span>
        </div>
      ) : (
        <>
          <div className="bq-ans">
            <span className="bq-cap">Your answer</span>
            <blockquote data-testid="banks-q-your-answer" data-content="learner">{answer}</blockquote>
          </div>
          <div className="bq-ans">
            <span className="bq-cap bq-ok">Model answer</span>
            <blockquote data-testid="banks-q-model" {...plan}>{q.answer}</blockquote>
          </div>
          <div className="bq-ans">
            <span className="bq-cap">Checklist</span>
            <ul className="bq-checklist" data-testid="banks-q-checklist">
              {q.checklist.map((item, i) => (
                <li key={i}>
                  <label className="sr-choice">
                    <input type="checkbox" data-testid={`banks-q-check-${i + 1}`} checked={ticked.has(i)} onChange={e => tick(i, e.target.checked)} />
                    <span {...plan}>{item}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          {q.source && (
            <span className="banks-meta" data-testid="banks-q-source" data-content="plan">
              Source: {isUrl(q.source) ? <a className="banks-source" href={q.source} target="_blank" rel="noopener noreferrer">{q.source}</a> : q.source}
            </span>
          )}
          <div className="bq-grades" role="group" aria-label="How did it go?">
            {GRADES.map(g => (
              <Button key={g} data-testid={`banks-q-grade-${g}`} aria-pressed={grade === g} disabled={readOnly} onClick={() => void doGrade(g)}>{GRADE_LABEL[g]}</Button>
            ))}
          </div>
        </>
      )}

      <div className="bq-actions bq-after">
        {revealed && grade !== null && offersReview(grade) && !added && (
          <Button data-testid="banks-q-add-review" disabled={readOnly} onClick={() => void addReview()}>Add to Review</Button>
        )}
        {added && <Button data-testid="banks-q-added" disabled>Added to Review</Button>}
        {q.aiMade && !confirming && <Button variant="danger" data-testid="banks-q-delete" disabled={readOnly} onClick={() => setConfirming(true)}>Delete</Button>}
      </div>

      {q.aiMade && confirming && (
        <div className="bq-confirm" role="alertdialog" aria-label="Delete this question">
          <p>Delete this question and its grade? A Review card you already added stays.</p>
          <div className="bq-actions">
            <Button variant="danger" data-testid="banks-q-delete-confirm" disabled={readOnly} onClick={() => void remove()}>Yes, delete</Button>
            <Button variant="quiet" data-testid="banks-q-delete-cancel" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  )
}

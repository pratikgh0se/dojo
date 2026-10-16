import type { ReactNode } from 'react'
import type { Ticket } from '../../../data/types'
import { EXPLAIN_RESPONSE_MAX, type TicketWork } from '../../../study/useTicketWork'
import { Button } from '../../../ui/primitives'

/** "Explain it simply": answer first, reference after, never a gate. Shared by the resource and build views; null when the ticket has no questions. */
export function ExplainSection({ ticket, work, readOnly, actions }: { ticket: Ticket; work: TicketWork; readOnly: boolean; actions?: ReactNode }) {
  const qs = ticket.explain ?? []
  if (qs.length === 0) return null
  const answered = work.answers.every(a => a.trim() !== '')
  return (
    <section className="dk-box sr-panel" data-testid="ticket-explain" aria-label="Explain it simply">
      <h2 className="dk-cap">Explain it simply</h2>
      {qs.map((q, i) => (
        <div key={i} className="dk-qa">
          <p className="dk-q" data-testid={`ticket-explain-q-${i + 1}`} data-content="plan"><span className="mono">Q{i + 1}</span> {q}</p>
          <textarea
            aria-label={`Answer to question ${i + 1}`} data-testid={`ticket-explain-answer-${i + 1}`} data-content="learner" disabled={readOnly} rows={3} maxLength={EXPLAIN_RESPONSE_MAX}
            value={work.answers[i] ?? ''} onChange={e => work.setAnswer(i, e.target.value)} onBlur={() => void work.flush()}
          />
          {work.revealed && (
            <div className="dk-ref">
              <b>Reference</b>
              <p data-testid={`ticket-reference-${i + 1}`} data-content="plan">{ticket.explainAnswers?.[i] ?? 'No reference answer is stored for this question.'}</p>
            </div>
          )}
        </div>
      ))}
      <div className="dk-actions">
        {!work.revealed && <Button data-testid="ticket-reveal" disabled={!answered} onClick={work.reveal}>Reveal reference answers</Button>}
        {actions}
      </div>
    </section>
  )
}

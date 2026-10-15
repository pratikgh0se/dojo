import type { ReactNode } from 'react'
import type { Ticket } from '../../../data/types'
import { LEARNER_NOTES_MAX, type TicketWork } from '../../../study/useTicketWork'
import { shownText } from '../../../rules/ticketText'
import { Glyph } from '../../../ui/Glyph'
import { StatementText } from '../../../ui/StatementText'
import { Button, useToast } from '../../../ui/primitives'

const GPU: Record<'none' | 'free' | 'rented', string> = { none: 'No GPU', free: 'Free GPU', rented: 'Rented GPU' }
export const LAB_STEPS = ['up', 'run', 'check', 'down'] as const
/** The standard lab targets (spec S4): `make -C labs/<id> up | run | check | down`. */
export const labCommand = (labId: string, step: (typeof LAB_STEPS)[number]): string => `make -C labs/${labId} ${step}`

/** A build ticket: its text, the lab marker, the four lab steps, and an honest self-mark (checks and reviewer come in R2). */
export function BuildBody({ ticket, work, readOnly, actions }: { ticket: Ticket; work: TicketWork; readOnly: boolean; actions?: ReactNode }) {
  const toast = useToast()
  const lab = ticket.lab
  const text = shownText(ticket.text)
  async function copy(cmd: string) {
    try { await navigator.clipboard.writeText(cmd); toast('Copied.') } catch { toast('Copy failed. Select the command and copy it by hand.', 'warn') }
  }
  return (
    <>
      {text && <StatementText text={text} />}
      {lab && (
        <section className="dk-box sr-panel">
          <div className="dk-trow">
            <span className="dk-cap">Lab steps</span>
            <span className="dk-chip" data-testid="ticket-lab">{GPU[lab.gpu]}{lab.gpu === 'rented' && lab.costUsd !== undefined ? ` · $${lab.costUsd}` : ''}</span>
          </div>
          <ol className="dk-steps" data-testid="ticket-lab-steps">
            {LAB_STEPS.map(s => (
              <li key={s} className="dk-step" data-testid={`ticket-lab-step-${s}`}>
                <span className="dk-cap">{s[0].toUpperCase() + s.slice(1)}</span>
                <code data-testid={`ticket-lab-command-${s}`}>{labCommand(lab.id, s)}</code>
                <Button variant="quiet" data-testid={`ticket-lab-copy-${s}`} aria-label={`Copy the ${s} command`} onClick={() => void copy(labCommand(lab.id, s))}><Glyph name="copy" /> Copy</Button>
              </li>
            ))}
          </ol>
        </section>
      )}
      <label className="dk-self">
        <input type="checkbox" data-testid="ticket-selfmark" disabled={readOnly} checked={work.selfMark === 'done'} onChange={e => work.setSelfMark(e.target.checked ? 'done' : undefined)} />
        I ran the lab and looked at the result myself.
      </label>
      <section className="dk-box sr-panel">
        <label className="dk-cap" htmlFor={`notes-${ticket.id}`}>Notes while you work</label>
        <textarea id={`notes-${ticket.id}`} data-testid="ticket-notes" data-content="learner" disabled={readOnly} rows={5} maxLength={LEARNER_NOTES_MAX} value={work.notes} onChange={e => work.setNotes(e.target.value)} onBlur={() => void work.flush()} />
        {actions && <div className="dk-actions">{actions}</div>}
      </section>
    </>
  )
}

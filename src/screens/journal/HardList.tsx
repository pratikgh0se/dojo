import { useRef } from 'react'
import { useDb } from '../../app/providers'
import { addHardToReview } from '../../data/journalActions'
import { safeWrite } from '../../data/safeWrite'
import type { JournalRow, Redo, Ticket } from '../../data/types'
import { isReadOnly } from '../../data/writer'
import { now } from '../../lib/clock'
import { HARD_WINDOW_DAYS, hardList } from '../../rules/journal'
import { Button, useToast } from '../../ui/primitives'

/**
 * JOURNAL-18 to JOURNAL-22: "Came up hard this week". Tickets with two or more hard signals (Again or Hard, or explain No) in
 * the 14 days ending on the clock day, each with a button that puts one review card for it into Review, due today.
 */
export function HardList({ rows, tickets, redos, today }: {
  rows: readonly JournalRow[]; tickets: readonly Ticket[]; redos: readonly Redo[]; today: string
}) {
  const d = useDb()
  const toast = useToast()
  const readOnly = isReadOnly()
  const busy = useRef(new Set<string>())
  const list = hardList(rows, tickets, today)
  const inReview = new Set(redos.filter(r => r.source === 'journal_hard' && r.closedAt === undefined).map(r => r.ticketId))

  async function add(ticketId: string) {
    if (readOnly || busy.current.has(ticketId)) return
    busy.current.add(ticketId)
    try {
      await safeWrite(() => addHardToReview(d, ticketId, now()), m => toast(m, 'danger'))
    } catch {
      toast('That card was not added. Try again.', 'danger')
    } finally {
      busy.current.delete(ticketId)
    }
  }

  return (
    <section className="jr-hard jr-panel sr-panel" data-testid="journal-hard" aria-labelledby="journal-hard-heading">
      <h2 className="jr-h" id="journal-hard-heading">Came up hard this week</h2>
      {list.length === 0 ? (
        <p className="jr-empty" data-testid="journal-hard-empty" data-empty="true">Nothing came up hard.</p>
      ) : (
        <ul className="jr-hard-list">
          {list.map(h => (
            <li key={h.ticket.id} className="jr-hard-row" data-testid={`journal-hard-${h.ticket.id}`}>
              <div className="jr-hard-what">
                <span className="jr-hard-title" data-content="plan">{h.ticket.title}</span>
                <span className="jr-meta" data-testid={`journal-hard-count-${h.ticket.id}`} data-count={h.count}>{h.count} times in {HARD_WINDOW_DAYS} days</span>
              </div>
              {inReview.has(h.ticket.id) ? (
                <span className="jr-added" data-testid={`journal-hard-added-${h.ticket.id}`}>In Review</span>
              ) : (
                <Button variant="quiet" data-testid={`journal-hard-add-${h.ticket.id}`} disabled={readOnly} aria-label={`Add to Review: ${h.ticket.title}`} onClick={() => void add(h.ticket.id)}>Add to Review</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

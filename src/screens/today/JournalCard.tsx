import { Link } from 'react-router-dom'
import { useJournalRow } from '../../data/hooks'
import { localDayKey } from '../../lib/dates'
import { journalCardState } from '../../rules/journal'
import { Glyph } from '../../ui/Glyph'
import './ritual.css'

/**
 * TODAY-49: from 17:00 local a quiet card links to the journal. "Journal: how did today go?" until the day has an entry, then
 * "Journal saved". It is not a ticket and not a task: no checkbox, no XP, no count, no time left, and it never names an earlier day
 * or a missing entry. Reading it writes nothing.
 */
export function JournalCard({ nowMs }: { nowMs: number }) {
  const row = useJournalRow(localDayKey(nowMs))
  if (row === undefined) return null // loading: nothing is drawn, so a saved day never flashes the open card
  const state = journalCardState(nowMs, row ? [row] : [])
  if (!state) return null
  return (
    <section className="rt-card sr-panel jc-card" data-testid="today-journal" data-state={state} aria-label="Journal">
      <Link className="jc-link" data-testid="today-journal-link" to="/journal"><span>{state === 'saved' ? 'Journal saved' : 'Journal: how did today go?'}</span><Glyph name="chevronR" size={2} /></Link>
    </section>
  )
}

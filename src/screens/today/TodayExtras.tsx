import { useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useDb } from '../../app/providers'
import { openRitualTicket } from '../../data/ritualActions'
import { safeWrite } from '../../data/safeWrite'
import { useLatestFocus } from '../../data/weeklyHooks'
import type { Ticket } from '../../data/types'
import { READ_ONLY_MESSAGE } from '../../data/writer'
import { now } from '../../lib/clock'
import { bodyOf, ritualOpen, ritualTicketId, SWAP_DRILL_ID, WEEKLY_REVIEW_ID, type RitualEntry } from '../../rules/ritualPeriod'
import { WELCOME_LINE } from '../../rules/floor'
import type { Lead } from '../../rules/restart'
import { Button, useToast } from '../../ui/primitives'
import './ritual.css'

/**
 * W5: a windowed ritual (weekly review from Sunday 12:00; monthly swap drill from the first Saturday). Same pattern as RitualWeekly:
 * nothing is written until Open. No skip button and no count: the card is gone when its window ends. A done ritual keeps its card
 * with the word "Done"; Open still leads to the Week view (weekly review) or the ticket (drill).
 */
function RitualDue({ entry, tickets, nowMs, readOnly }: { entry: RitualEntry; tickets: readonly Ticket[]; nowMs: number; readOnly: boolean }) {
  const d = useDb()
  const toast = useToast()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const period = ritualOpen(entry, nowMs)
  if (!period) return null
  const id = ritualTicketId(entry.id, period.key)
  const ticket = tickets.find(t => t.id === id && !t.archived)
  const done = ticket?.status === 'done'
  const to = entry.id === WEEKLY_REVIEW_ID ? '/journal?view=week' : `/do/${id}`
  const open = async (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    if (busy) return
    if (ticket) { navigate(to); return }
    if (readOnly) { toast(READ_ONLY_MESSAGE, 'warn'); return }
    setBusy(true)
    try {
      // RIT-69: load the target screen with the write, so the ticket page is already drawn when the URL changes (no blank page in between)
      const target = entry.id === WEEKLY_REVIEW_ID ? import('../Journal') : import('../Do')
      const [made] = await Promise.all([safeWrite(() => openRitualTicket(d, entry, now()), m => toast(m, 'danger')), target.catch(() => undefined)])
      if (made) navigate(to)
    } finally { setBusy(false) }
  }
  return (
    <section className="rt-card sr-panel rd-card" data-testid={`today-ritual-${entry.id}`} data-state={done ? 'done' : 'open'} aria-label={entry.title}>
      <div className="rt-row">
        <span className="qc-cap rt-grow">{entry.cadence === 'monthly' ? `${entry.title} · monthly` : entry.title}</span>
        {done && <span className="qc-cap rt-ok" data-testid={`today-ritual-${entry.id}-state`}>Done</span>}
      </div>
      <p className="rt-copy">{bodyOf(entry)}</p>
      <div className="qc-ractions">
        <Link className="sr-btn sr-btn-quiet" data-testid={`today-ritual-open-${entry.id}`} to={to} onClick={e => void open(e)} aria-disabled={busy || undefined}>Open</Link>
      </div>
    </section>
  )
}

/** The windowed ritual cards, the weekly review first and the swap drill after it (RIT-73). `try-new-model` and the daily pulse keep their own cards. */
export function Rituals({ tickets, nowMs, rituals, readOnly }: { tickets: readonly Ticket[]; nowMs: number; rituals: readonly RitualEntry[]; readOnly: boolean }) {
  return (
    <>
      {[WEEKLY_REVIEW_ID, SWAP_DRILL_ID].flatMap(id => rituals.filter(e => e.id === id)).map(e => (
        <RitualDue key={e.id} entry={e} tickets={tickets} nowMs={nowMs} readOnly={readOnly} />
      ))}
    </>
  )
}

/** The chosen focus for the coming week: one line, no heading, no deadline; hidden when empty. It sits above the quest. */
export function Focus() {
  const focus = useLatestFocus()
  if (!focus) return null
  return <p className="rt-focus" data-testid="today-focus" data-content="learner">{focus}</p>
}

/**
 * Always on Today: up to five cards, then one line, 15 minutes. After a gap (`restart`) or on a short day (`short`) it leads the
 * column (CSS `order`), takes the one accent, and the usual mix is collapsed behind the toggle (RIT-52, RIT-53).
 */
export function Floor({ lead, open, resuming, onToggle }: { lead: Lead; open: boolean; resuming: boolean; onToggle: () => void }) {
  const accent = lead !== null && !open && !resuming // a started ticket's quest holds the accent (RIT-54)
  return (
    <>
      {lead === 'restart' && <p className="fl-welcome" data-testid="today-welcome">{WELCOME_LINE}</p>}
      <section className="fl-card sr-panel" data-testid="today-floor" data-lead={lead ?? undefined} aria-label="Floor">
        <span className="qc-cap">Floor: 15 minutes</span>
        <p className="rt-copy">Up to five cards, then one line about today.</p>
        <Link className={`sr-btn ${accent ? 'sr-btn-accent' : 'sr-btn-quiet'}`} {...(accent ? { 'data-accent': 'primary' } : {})} data-testid="today-floor-start" to="/floor">START · FLOOR</Link>
      </section>
      {lead !== null && (
        <Button variant="quiet" className={resuming ? 'fl-toggle fl-after' : 'fl-toggle'} data-testid="today-mix-toggle" aria-expanded={open} onClick={onToggle}>
          {open ? 'Hide the usual mix' : 'Show the usual mix'}
        </Button>
      )}
    </>
  )
}

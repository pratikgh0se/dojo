import { Link } from 'react-router-dom'
import type { StoredEvent, Ticket } from '../../data/types'
import { weekdayOf } from '../../lib/dates'
import {
  cardDayType, dayTypeOf, isOverBudget, loadMinutesText, minutesUsedToday, rolledNote, rolledText, suggestCards,
} from '../../rules/workload'
import '../brief/brief.css'

const DAY_WORD = { focus: 'focus day', light: 'light day', long: 'long day' } as const

/** Briefs spec §3 on Today: planned minutes against the sprint budget, today's time left from real focus minutes, roll-over note, and cards that fit today. */
export function WorkloadPanel({ tickets, sprint, budget, planned, nowMs, events = [] }: {
  tickets: Ticket[]; sprint: number; budget: number; planned: number; nowMs: number; events?: readonly StoredEvent[]
}) {
  const type = dayTypeOf(weekdayOf(nowMs))
  // time used today: finished cards with no focus today, plus today's real focus minutes (Part 2)
  const used = minutesUsedToday(tickets, events, nowMs)
  const suggestions = suggestCards(tickets, sprint, nowMs, used)
  const rolled = rolledNote(tickets, sprint)
  return (
    <section className="sr-panel wl" aria-label="Workload">
      <h2 className="health-title">Workload</h2>
      <p className="wl-load" data-testid="load-minutes" data-over={isOverBudget(planned, budget) ? 'true' : 'false'}>{loadMinutesText(planned, budget)}</p>
      <p className="wl-line">planned this sprint, against the core-minutes budget</p>
      {rolled && <p className="wl-rolled" data-testid="rolled-note">{rolledText(rolled)}</p>}
      <h3 className="brief-sub">Suggested for today · {DAY_WORD[type]}</h3>
      <ul className="wl-list" data-testid="suggested">
        {suggestions.map(s => (
          <li key={s.ticket.id} data-daytype={cardDayType(s.ticket)}>
            <Link to={`/do/${s.ticket.id}`} data-testid={`do-${s.ticket.id}`} aria-label={`Do: ${s.ticket.title}`}>{s.ticket.title}</Link>
            <span className="wl-line"> · {s.minutes} min · {cardDayType(s.ticket)}</span>
          </li>
        ))}
      </ul>
      {suggestions.length === 0 && <p className="wl-line">Nothing left that fits today.</p>}
    </section>
  )
}

import type { Session, Ticket } from '../../data/types'
import { now } from '../../lib/clock'
import { laneMinutes, paceText, planMinutes, recentMinutes } from '../../rules/stats'
import { LANE_LABEL, tagLane } from '../../rules/ticketMeta'
import { SkMeter } from './Meter'

export function Stats({ tickets, sessions, coreMinutes }: { tickets: readonly Ticket[]; sessions: readonly Session[]; coreMinutes: number }) {
  const all = planMinutes(tickets)
  // README lane tag: a bank ticket counts as DSA, so there is no bank row.
  const rows = laneMinutes(tickets, tagLane)
  const recent = recentMinutes(sessions, now())
  return (
    <section className="sk-stats" data-testid="skills-stats" aria-label="Stats">
      <div className="sr-panel sk-sbox">
        <span className="sk-cap">Minutes in the plan</span>
        <p className="sk-sbig"><span data-testid="skills-stats-done-min">{all.done}</span> <span className="sk-meta">done of</span> <span data-testid="skills-stats-total-min">{all.total}</span> <span className="sk-meta">min</span></p>
        <p className="sk-meta" data-testid="skills-stats-pace">{paceText(recent, coreMinutes)}</p>
      </div>
      <ul className="sr-panel sk-lanes" aria-label="Minutes by lane">
        {rows.map(r => (
          <li key={r.lane} data-testid={`skills-stats-lane-${r.lane}`} data-done={r.minutes.done} data-total={r.minutes.total}>
            <span className="sk-lname">{LANE_LABEL[r.lane]}</span>
            <SkMeter done={r.minutes.done} total={r.minutes.total} label={`${LANE_LABEL[r.lane]} minutes`} testId={`skills-stats-lane-meter-${r.lane}`} />
            <span className="mono">{r.minutes.done} of {r.minutes.total} min</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

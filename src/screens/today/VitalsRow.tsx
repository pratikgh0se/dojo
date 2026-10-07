import { tipProps } from '../../ui/Tip'
import type { SettingsRow } from '../../data/db'
import type { PlanJson, Session, StoredEvent, Ticket } from '../../data/types'
import { focusMinutesToday } from '../../rules/focus'
import { activityByDay, calendarGrid, calendarTotal } from '../../rules/calendar'
import { carrotHp, milestoneBadges, pomPose, sprintDates, sprintDays } from '../../rules/vitals'
import { planXp, totalXp } from '../../rules/xp'
import { SrChart } from '../../ui/engines/SrChart'
import { usePowerUp } from '../../ui/primitives'
import { Vitals } from '../../ui/Vitals'
import { ConsistencyGrid } from './ConsistencyGrid'

/** README-dashboard "Today" §2: Pom · Sprint clock · Consistency. */
export function VitalsRow({
  plan, tickets, sessions, settings, sprint, dayInSprint, nowMs, events,
}: {
  plan: PlanJson; tickets: Ticket[]; sessions: Session[]; settings: SettingsRow
  sprint: number; dayInSprint: number; nowMs: number; events: StoredEvent[]
}) {
  const { active } = usePowerUp()
  const days = sprintDays(settings.startDate, sprint, dayInSprint, plan.rotation)
  const hp = carrotHp(tickets, sprint)
  const grid = calendarGrid(activityByDay(tickets, sessions), nowMs)
  return (
    <div className="vitals-row">
      <Vitals xp={totalXp(tickets)} formXp={planXp(tickets)} possible={settings.possibleXp} pose={pomPose(active, tickets, sprint)} />
      <section className="sr-panel sprint-clock" aria-label="Sprint clock">
        <div className="vital-head">
          <span className="vital-label">Sprint clock</span>
          <span className="vital-meta" data-testid="sprint-dates">{sprintDates(settings.startDate, sprint)}</span>
        </div>
        <div className="day-strip" role="img" aria-label="Sprint days" data-testid="day-strip">
          {days.map((d, i) => <i key={i} className="day-cell" data-state={d} />)}
        </div>
        <div className="vital-head hp-head">
          <span className="vital-label">Carrot HP · tasks left</span>
          <span className="vital-meta vital-meta-strong" data-testid="carrot-hp" {...tipProps(`${hp.left} of ${hp.max} plan tasks left this sprint (AI and interview tasks; the Board also counts DSA cards)`)}>{hp.left}/{hp.max}</span>
        </div>
        <div className="hp-bar">
          <SrChart type="hpBar" data={{ max: hp.max, value: hp.left }} testId="carrot-hp-bar" label={`Carrot HP ${hp.left} of ${hp.max}`} />
        </div>
        <div className="vital-head hp-head">
          <span className="vital-label">Focus today</span>
          <span className="vital-meta vital-meta-strong" data-testid="focus-today" title="Logged focus today: the finished focus blocks, the same minutes as Week and Progress">{focusMinutesToday(events, nowMs)} min</span>
        </div>
        <div className="ms-badges">
          {milestoneBadges(tickets).map(b => (
            <div
              key={b.glyph} className={`ms-badge${b.on ? ' on' : ''}`} title={b.hint} role="img"
              aria-label={`${b.hint}${b.on ? ', earned' : ''}`} data-testid={`badge-${b.glyph}`} data-on={b.on ? 'true' : 'false'}
            >
              {b.glyph}
            </div>
          ))}
        </div>
      </section>
      <section className="sr-panel consistency" aria-label="Consistency">
        <div className="vital-head">
          <span className="vital-label">Consistency · 8 weeks</span>
          <span className="vital-meta vital-meta-strong" data-testid="cal-total">{calendarTotal(grid)} logged</span>
        </div>
        <div className="console-well cal-well">
          <ConsistencyGrid grid={grid} />
        </div>
      </section>
    </div>
  )
}

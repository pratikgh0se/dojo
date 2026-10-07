import type { StoredEvent, Ticket } from '../../data/types'
import { focusHistoryDays, focusMinutesSince } from '../../rules/focus'
import { SPRINT_DAYS } from '../../rules/sprint'
import { cssVar } from '../../lib/cssVar'
import { healthColumns, healthStats, loadCheck } from '../../rules/load'
import { plannedMinutes } from '../../rules/workload'
import { SrChart } from '../../ui/engines/SrChart'
import { tipProps } from '../../ui/Tip'
import { SlideAsk } from './SlideAsk'

const SERIES_TOKENS = ['--sr-energy-accent', '--sr-signal-danger', '--sr-chart-axis'] as const

/** README-dashboard "Today" §3: Sprint by sprint + Load check. */
export function HealthPanel({
  tickets, sprint, dayInSprint, nowLabel, events, nowMs, budget,
}: { tickets: Ticket[]; sprint: number; dayInSprint: number; nowLabel: string; events: StoredEvent[]; nowMs: number; budget: number }) {
  const cols = healthColumns(tickets, sprint, nowLabel)
  const stats = healthStats(tickets, sprint)
  const focus7 = focusMinutesSince(events, nowMs, 7)
  // ruling 24 S2: no pace from a few finished blocks; until a sprint has ended (or a week is logged) the plan is judged against the budget
  const load = loadCheck(
    tickets, sprint, dayInSprint,
    { perSprint: focus7 * (SPRINT_DAYS / 7), historyDays: focusHistoryDays(events, nowMs) },
    { planned: plannedMinutes(tickets, sprint), budget },
  )
  const colors = SERIES_TOKENS.map(cssVar)
  const data = {
    series: [cols.map(c => c.done), cols.map(c => c.behind), cols.map(c => c.todo)],
    labels: cols.map(c => c.label),
  }
  const opts = { barWidth: 18, ...(colors.every(Boolean) ? { colors } : {}) }
  return (
    <section className="sr-panel health" aria-label="Sprint health">
      <div className="health-col">
        <div className="health-head">
          <h2 className="health-title">Sprint by sprint</h2>
          <span className="health-legend vital-label">
            <span><i className="hl-swatch hl-done" />done</span>
            <span><i className="hl-swatch hl-behind" />left behind</span>
            <span><i className="hl-swatch hl-todo" />to do</span>
          </span>
        </div>
        <div className="console-well health-chart">
          <SrChart type="stackedColumn" data={data} opts={opts} testId="health-chart" label="Tasks done, left behind and to do, sprint by sprint" />
        </div>
        <div className="health-stats">
          {stats.map(s => (
            <div key={s.label} className="health-stat" data-testid="health-stat" {...(s.tip ? tipProps(s.tip) : {})}>
              <div className="vital-label">{s.label}</div>
              <div className={`health-stat-value st-${s.tone}${/^\d+\/\d+$/.test(String(s.value)) ? ' is-ratio' : ''}`}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="health-col">
        <div className="health-head">
          <h2 className="health-title">Load check</h2>
          <span className={`load-verdict ${load.heavy ? 'is-heavy' : 'is-fits'}`} data-testid="load-verdict">{load.verdict}</span>
        </div>
        <div className="load-rows">
          {load.rows.map(r => (
            <div key={r.label} className="load-row" data-testid="load-row">
              <span className="vital-label">{r.label}</span>
              <span className="load-cells" aria-hidden="true">{r.cells.map((c, i) => <i key={i} className="load-cell" data-cell={c} />)}</span>
              <span className="load-n">{r.n}</span>
            </div>
          ))}
        </div>
        <p className="load-text" data-testid="load-text">{load.text}</p>
        <p className="load-focus" data-testid="load-focus">{focus7} min of real focus in the last 7 days</p>
        <SlideAsk tickets={tickets} sprint={sprint} load={load} />
      </div>
    </section>
  )
}

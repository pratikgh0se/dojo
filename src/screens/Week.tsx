import { Link } from 'react-router-dom'
import { usePlan } from '../app/providers'
import { useFocusEvents, useSettings, useTickets } from '../data/hooks'
import { localDayKey } from '../lib/dates'
import { useNow } from '../lib/useNow'
import { effectiveLastSprint } from '../rules/sprint'
import { sprintCalendar, WEEK_TARGET_MIN, weeklyMinutes, weekTiles } from '../rules/week'
import { StackedColumns } from '../ui/charts'
import { Panel } from '../ui/primitives'
import { tipProps } from '../ui/Tip'
import './week.css'
import { Loading } from '../ui/Loading'

const AGAIN_TITLE = 'Second pass: re-solve it from memory'

export function Week() {
  const plan = usePlan()
  const tickets = useTickets()
  // ruling 24 S3: the day lines and the weekly chart count the logged focus minutes, the same ones as Today and Progress
  const events = useFocusEvents(0)
  const settings = useSettings()
  const t = useNow(60_000)
  if (!tickets || !events || !settings) return <Loading />
  const lastSprint = effectiveLastSprint(tickets)
  const tiles = weekTiles(t, settings.startDate, plan.rotation, tickets, events, lastSprint)
  const cal = sprintCalendar(t, settings.startDate, plan.rotation, lastSprint)
  const mins = weeklyMinutes(events, t)
  return (
    <div className="content-screen week">
      <h1 className="screen-title">Week</h1>
      <div className="week-tiles">
        {tiles.map(tile => (
          <section
            key={tile.day}
            className={`week-tile${tile.isToday ? ' is-today' : ''}${tile.rest ? ' rest' : ''}`}
            data-testid={`day-${tile.day}`}
            aria-current={tile.isToday ? 'date' : undefined}
            aria-label={`${tile.day} ${tile.dateKey}`}
          >
            <header className="week-head">
              <span className="week-day">{tile.day}</span>
              <span className="week-date">{tile.dateKey.slice(5)}</span>
            </header>
            <p className="week-role">{tile.role || '—'}</p>
            {tile.tickets.length > 0 && (
              <ul className="week-picks">
                {tile.tickets.map(tk => (
                  <li key={tk.id}>
                    <Link to={`/do/${tk.id}`}>{tk.title}</Link>
                    {/* ruling 22 D2: the plan's second pass at a card this week; cu-3 P3-4: the title is shown on hover (ui/Tip) */}
                    {tile.again.includes(tk.id) && (
                      <>
                        {' '}
                        <span className="chip week-again" data-testid={`again-${tile.day}-${tk.id}`} {...tipProps(AGAIN_TITLE)}>↻ again</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {tile.sprint !== null && (
              <p className="week-meta" data-testid={`day-meta-${tile.day}`}>
                <span className="week-done">{tile.done} done</span>
                <span className="week-sep"> · </span>
                <span className="week-focus">{tile.minutes} min focus</span>
              </p>
            )}
          </section>
        ))}
      </div>
      {cal && (
        <Panel title={`Sprint ${cal.sprint} · 14 days`}>
          <div className="sprint-cal">
            {cal.days.map(d => (
              <span
                key={d.dateKey}
                className={`cal-day${d.isToday ? ' is-today' : ''}${d.past ? ' past' : ''}`}
                data-testid={`cal-${d.dateKey}`}
                data-track={d.track ?? 'none'}
                title={`${d.day} ${d.dateKey}`}
              >
                <span className="cal-dow">{d.day.slice(0, 2)}</span>
                {/* UAT cu-6 P3-13: the day of the month, so the 14 cells say which days they are */}
                <span className="cal-date">{Number(d.dateKey.slice(8, 10))}</span>
                <i className={`dot dot-${d.track ?? 'none'}`} />
              </span>
            ))}
          </div>
        </Panel>
      )}
      <Panel title="Minutes per week · last 8 weeks">
        <StackedColumns
          label="Minutes per week, last 8 weeks"
          series={[{ key: 'minutes', label: 'Minutes', tone: 'accent' }]}
          columns={mins.map(w => {
            const k = localDayKey(w.weekStart)
            return { label: `${k.slice(8, 10)}·${k.slice(5, 7)}`, values: [w.minutes] }
          })}
          threshold={WEEK_TARGET_MIN}
        />
        <p className="hint">Logged focus minutes (finished focus blocks), as on Today and Progress. Dashed line: {WEEK_TARGET_MIN} minutes, the weekly target.</p>
      </Panel>
    </div>
  )
}

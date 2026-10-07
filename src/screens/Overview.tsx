import { useLayoutEffect, useRef, useState } from 'react'
import { usePlan } from '../app/providers'
import { NARROW_QUERY, useMediaQuery } from '../lib/useMediaQuery'
import { COVERAGE, OUT_OF_SCOPE, rulesOfTheRoad, UNDERSTANDING } from '../content/overview'
import { scheduleOf } from '../content/schedule'
import { useSettings, useTickets } from '../data/hooks'
import { useNow } from '../lib/useNow'
import { timelineBands, timelineTicks, type Band, type Timeline as TimelineData } from '../rules/overview'
import { effectiveLastSprint } from '../rules/sprint'
import { ProseSectionView, ProseTableView } from '../ui/Prose'
import { Panel } from '../ui/primitives'
import './overview.css'
import { Loading } from '../ui/Loading'

const LEFT = 84
const ROW = 26
const TOP = 6
const MIN_COL = 8
/** Chivo 14 px averages under 8 px a glyph; a band label shows only when it fits whole (ui-reference R3). */
const CHAR_PX = 8
const fits = (label: string, px: number) => label.length * CHAR_PX + 8 <= px

/** Width of an element, tracked (the timeline draws at 1:1 pixels, never scaled). */
function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setW(el.clientWidth)
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function Overview() {
  const plan = usePlan()
  const settings = useSettings()
  const tickets = useTickets()
  const t = useNow(60_000)
  if (!settings || !tickets) return <Loading />
  const tl = timelineBands(plan, settings.startDate, t, effectiveLastSprint(tickets))
  const ticks = timelineTicks(settings.startDate, tl.total)
  return (
    <div className="content-screen overview">
      <h1 className="screen-title">Overview</h1>
      <Panel title={`Plan timeline · ${tl.total} sprints`}>
        <TimelineSvg tl={tl} ticks={ticks} />
        <p className="hint">Dashed line: checkpoint S{tl.checkpoint}. Yellow line: now.</p>
      </Panel>
      <ProseTableView table={COVERAGE} testId="coverage" />
      <div className="two-col">
        <ProseSectionView section={rulesOfTheRoad(scheduleOf(plan))} />
        <ProseSectionView section={UNDERSTANDING} />
      </div>
      <ProseSectionView section={OUT_OF_SCOPE} />
    </div>
  )
}

function TimelineSvg({ tl, ticks }: { tl: TimelineData; ticks: { sprint: number; label: string }[] }) {
  const phone = useMediaQuery(NARROW_QUERY)
  const tablet = useMediaQuery('(max-width: 1099px)')
  const [ref, avail] = useWidth<HTMLDivElement>()
  // R3: a tick every 4 sprints on desktop, every 8 on tablet, every 12 on phone.
  const every = phone ? 12 : tablet ? 8 : 4
  const rows: { key: string; label: string; bands: Band[] }[] = [
    { key: 'phase', label: 'Phases', bands: tl.phases },
    { key: 'stage', label: 'Stages', bands: tl.stages },
    { key: 'design', label: 'Designs', bands: tl.designs ? [tl.designs] : [] },
  ]
  const col = Math.max(MIN_COL, Math.floor(((avail || 0) - 16 - LEFT - 8) / tl.total))
  const width = LEFT + tl.total * col + 8
  const bottom = TOP + rows.length * ROW
  const spacing = every * col
  // UAT cu-6 P3-11: on a phone the ticks are the sprint numbers alone (S1, S13, ...); the date is in each tick's tooltip
  const withDates = !phone && spacing >= 84
  const height = bottom + (withDates ? 40 : 24)
  const x = (s: number) => LEFT + (s - 1) * col
  const shown = ticks.filter(tk => (tk.sprint - 1) % every === 0)
  return (
    <div className="timeline-scroll sc" ref={ref}>
      <svg className="timeline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Plan timeline, ${tl.total} sprints`}>
        {rows.map((r, ri) => (
          <g key={r.key}>
            <text className="tl-row" x={0} y={TOP + ri * ROW + 15}>{r.label}</text>
            {r.bands.map((b, bi) => {
              const w = (b.to - b.from + 1) * col - 1
              const name = `${b.label} · S${b.from}–S${b.to}`
              return (
                <g key={`${r.key}-${bi}`} data-testid={`band-${r.key}-${bi}`} data-from={b.from} data-to={b.to} aria-label={name}>
                  <title>{name}</title>
                  <rect className={`tl-band tl-${r.key} tl-alt-${bi % 2}`} x={x(b.from)} y={TOP + ri * ROW} width={w} height={ROW - 4} />
                  {fits(b.label, w) && <text className="tl-label" x={x(b.from) + 4} y={TOP + ri * ROW + 15}>{b.label}</text>}
                </g>
              )
            })}
          </g>
        ))}
        <line className="tl-checkpoint" data-testid="timeline-checkpoint" x1={x(tl.checkpoint) + col} x2={x(tl.checkpoint) + col} y1={0} y2={bottom} />
        {tl.now !== null && (
          <line className="tl-now" data-testid="timeline-now" x1={x(tl.now) + col / 2} x2={x(tl.now) + col / 2} y1={0} y2={bottom} />
        )}
        {shown.map(tk => {
          const [sprint, date] = tk.label.split(' · ')
          return (
            <g key={tk.sprint} data-testid={`tick-${tk.sprint}`}>
              {date && <title>{`${sprint} starts ${date}`}</title>}
              <text className="tl-tick" x={x(tk.sprint)} y={bottom + 16}>{sprint}</text>
              {date && withDates && <text className="tl-date" x={x(tk.sprint)} y={bottom + 34}>{date}</text>}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

import { calendarChartData, type CalendarGrid } from '../../rules/calendar'
import { tipProps } from '../../ui/Tip'

/** The sr-chart `calendar` engine's orange ramp (charts.js seqO): 0 is the dark shade, 1 to 5 the heat. */
const LEVELS = 6

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const ROW_LABELS: Array<[string, number]> = [['M', 1], ['W', 3], ['F', 5]]

/** "Tue 2026-10-06 · 2 logged": what a cell is, said where a lit cell cannot be read otherwise (UAT cu-2p P3-2). */
export function cellText(key: string, count: number): string {
  const [y, m, d] = key.split('-').map(Number)
  const day = `${WEEKDAY[new Date(y, m - 1, d).getDay()]} ${key}`
  return count > 0 ? `${day} · ${count} logged` : `${day} · nothing logged`
}

/**
 * Consistency · 8 weeks: 8 columns of 7 days, Sunday first (M, W and F beside Monday, Wednesday and Friday), drawn as HTML
 * so it fills its panel and every cell can carry a tooltip the page shows itself (Tip). The sr-chart `calendar` engine capped a
 * cell at 12 px, which left the grid in the left third of its panel and its cells out of reach of a pointer (UAT cu-2p P3-2).
 * `data` keeps the engine's data shape (weeks of counts, future days null) for anything that reads the grid.
 */
export function ConsistencyGrid({ grid, testId = 'consistency-cal' }: { grid: CalendarGrid; testId?: string }) {
  const data = calendarChartData(grid)
  const max = Math.max(1, ...data.weeks.flat().map(v => v ?? 0))
  const level = (v: number | null) => (v === null ? -1 : v === 0 ? 0 : Math.min(LEVELS - 1, 1 + Math.floor((v / max) * (LEVELS - 1))))
  return (
    <div
      className="cons-cal" data-testid={testId} role="img" aria-label="Consistency calendar, last 8 weeks"
      {...({ data: JSON.stringify(data) } as Record<string, string>)}
    >
      {data.months.map(([label, week]) => <span key={label + week} className="cons-label cons-month" style={{ gridColumn: week + 2, gridRow: 1 }} aria-hidden="true">{label}</span>)}
      {ROW_LABELS.map(([l, row]) => <span key={l} className="cons-label" style={{ gridColumn: 1, gridRow: row + 2 }} aria-hidden="true">{l}</span>)}
      {grid.weeks.map((week, w) => week.map((c, i) => (
        <i
          key={c.key} className="cons-cell" data-testid="cal-cell" data-day={c.key} data-level={level(data.weeks[w][i])}
          style={{ gridColumn: w + 2, gridRow: i + 2 }}
          {...(c.future ? { 'aria-hidden': true } : tipProps(cellText(c.key, c.count)))}
        />
      )))}
    </div>
  )
}

import { CHART_LABEL_PX, edgeSafeLabel, fitLabel, thinnedIndices, usableScale } from './labelScale'
import type { ChartSeries } from './types'
import { useChartScale } from './useChartScale'
import './charts.css'

const BAR = 10
const GAP = 2
const GROUP_GAP = 14
const LABEL_H = 14
const VALUE_H = 12
const PAD = 4

export function GroupedColumns({
  series, groups, label, height = 96, max,
}: {
  series: ChartSeries[]
  groups: { label: string; values: number[] }[]
  label: string
  height?: number
  max?: number
}) {
  const top = Math.max(1, max ?? Math.max(0, ...groups.flatMap(g => g.values)))
  const groupW = series.length * BAR + Math.max(0, series.length - 1) * GAP
  const pitch = groupW + GROUP_GAP
  const width = PAD * 2 + groups.length * groupW + Math.max(0, groups.length - 1) * GROUP_GAP
  const plotH = height - LABEL_H - VALUE_H
  const base = VALUE_H + plotH
  const shown = thinnedIndices(groups.length, 1)
  const { ref, scale } = useChartScale(width)
  const s = usableScale(scale)
  return (
    <figure className="chart-well">
      <svg ref={ref} className="chart" viewBox={`0 0 ${width * s} ${height * s}`} style={{ maxWidth: width * 3 }} role="img" aria-label={label}>
        <g transform={`scale(${s})`}>
          <line className="chart-axis" x1={0} x2={width} y1={base} y2={base} />
          {groups.map((g, gi) => {
            const gx = PAD + gi * (groupW + GROUP_GAP)
            return (
              <g key={g.label} data-group={g.label}>
                {series.map((sr, si) => {
                  const v = g.values[si] ?? 0
                  const h = Math.round((v / top) * plotH)
                  const bx = gx + si * (BAR + GAP)
                  return <rect key={sr.key} className={`bar ct-${sr.tone}`} x={bx} y={base - h} width={BAR} height={h} data-series={sr.key} data-value={v} />
                })}
              </g>
            )
          })}
        </g>
        {groups.map((g, gi) => {
          const gx = PAD + gi * (groupW + GROUP_GAP)
          const { x, anchor } = edgeSafeLabel(gi, shown, (gx + groupW / 2) * s, width * s)
          return (
            <g key={`t-${g.label}`}>
              {series.map((sr, si) => {
                const v = g.values[si] ?? 0
                const h = Math.round((v / top) * plotH)
                const bx = gx + si * (BAR + GAP)
                return (
                  <text key={sr.key} className="chart-value" x={(bx + BAR / 2) * s} y={(base - h) * s - 2} textAnchor="middle" fontSize={CHART_LABEL_PX}>{v}</text>
                )
              })}
              <text className="chart-label" x={x} y={height * s - 2} textAnchor={anchor} fontSize={CHART_LABEL_PX}>
                {fitLabel(g.label, pitch * s, CHART_LABEL_PX)}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="chart-legend">
        {series.map(sr => (
          <span key={sr.key} className="legend-item"><i className={`legend-swatch ct-${sr.tone}`} />{sr.label}</span>
        ))}
      </figcaption>
    </figure>
  )
}

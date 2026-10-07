import { avgCharWidth, CHART_LABEL_PX, edgeSafeLabel, fitLabel, thinnedIndices, usableScale } from './labelScale'
import type { ChartSeries } from './types'
import { useChartScale } from './useChartScale'
import { useMediaQuery } from '../../lib/useMediaQuery'
import './charts.css'

export interface StackColumn { label: string; values: number[] }

const BAR = 10
const GAP = 4
const PAD = 4
const LABEL_H = 14
const TOP_PAD = 2
// Per-glyph width (user units, derived from the chart label font — see labelScale.ts)
// used to widen the column pitch so a labelled column's text has room, instead of the
// fixed BAR+GAP pitch (fine for short "S1"-style labels, too tight for multi-char ones
// like "07·09" when every column is labelled and there are few of them).
const LABEL_CHAR_W = avgCharWidth()
const LABEL_MARGIN = 6

// A StackedColumns chart's viewBox is only ever as wide as its columns need (see
// `width` below) — as narrow as ~18 units for a single column. The chart well's CSS
// stretches the SVG to `width: 100%` and lets `height: auto` follow the viewBox's own
// aspect ratio, so a chart that's normally a wide, short band (many columns) becomes a
// tall, narrow one with just one or two: the same aspect-ratio math that keeps a
// 12-column chart a couple hundred px tall stretches a 1-column chart to thousands of
// px (`width: 100%` on an ~18-unit-wide viewBox with a 96–120 unit height). Two caps
// fix this without touching the CSS-driven scaling the normal (3+ column) case relies
// on for width fill and text sizing (`useChartScale` / `labelScale.ts`, unchanged
// below for that case):
//  - MAX_HEIGHT_PX: a hard ceiling on the rendered height, applied as an inline
//    `max-height` so a normal chart's own CSS-derived height is only ever clamped
//    (letterboxed, not distorted) — in practice this never binds for 3+ columns.
//  - NARROW_COLUMNS / NARROW_SCALE: with 1–2 columns, skip the "stretch to fill the
//    panel" CSS path and size the SVG to a small, fixed pixel box instead — a modest,
//    stable bar size instead of either a razor-thin native bar or one blown up to the
//    full panel width.
const MAX_HEIGHT_PX = 240
const NARROW_COLUMNS = 2
const NARROW_SCALE = 3

export function StackedColumns({
  series, columns, label, height = 96, threshold, max,
}: { series: ChartSeries[]; columns: StackColumn[]; label: string; height?: number; threshold?: number; max?: number }) {
  const drawHeight = Math.min(height, MAX_HEIGHT_PX)
  // below 640 px the odd labels are hidden (charts.css), so a label that stays has two columns' width (cu-r1b F-B11)
  const slim = useMediaQuery('(max-width: 639px)')
  const totals = columns.map(c => c.values.reduce((a, v) => a + v, 0))
  const top = Math.max(1, max ?? Math.max(0, threshold ?? 0, ...totals))
  const every = Math.max(1, Math.ceil(columns.length / 12))
  const maxLabelLen = Math.max(0, ...columns.filter((_, ci) => ci % every === 0).map(c => c.label.length))
  const pitch = Math.max(BAR + GAP, maxLabelLen * LABEL_CHAR_W + LABEL_MARGIN)
  const width = PAD * 2 + Math.max(0, columns.length - 1) * pitch + BAR
  const plotH = drawHeight - LABEL_H - TOP_PAD * 2
  const base = TOP_PAD + plotH
  const shown = thinnedIndices(columns.length, every)
  const isNarrow = columns.length <= NARROW_COLUMNS
  // Narrow charts are sized from known values, not a measured scale: the rendered
  // scale is fixed at NARROW_SCALE (capped so drawHeight × scale never exceeds
  // MAX_HEIGHT_PX), and the label font size is derived from it the same way
  // non-narrow charts derive theirs from the *measured* scale below.
  const narrowScale = Math.min(NARROW_SCALE, MAX_HEIGHT_PX / drawHeight)
  const { ref, scale: measuredScale } = useChartScale(width)
  const s = usableScale(isNarrow ? narrowScale : measuredScale)
  // Only the narrow (1–2 column) case gets an inline style: a fixed pixel box so it
  // doesn't stretch to fill the panel. 3+ column charts keep the plain `width: 100%;
  // height: auto` from charts.css untouched — that's the fully-responsive fill
  // behavior a prior fix (dfd98e7) restored after an earlier `max-width` cap had
  // squeezed those charts into a fraction of their panel.
  const svgStyle = isNarrow
    ? { width: Math.round(width * narrowScale), height: Math.round(drawHeight * narrowScale), maxWidth: '100%' }
    : undefined
  return (
    <figure className="chart-well">
      <svg ref={ref} className="chart" style={svgStyle} viewBox={`0 0 ${width * s} ${drawHeight * s}`} role="img" aria-label={label}>
        <g transform={`scale(${s})`}>
          <line className="chart-axis" x1={0} x2={width} y1={base} y2={base} />
          {columns.map((c, ci) => {
            const cx = PAD + ci * pitch
            let cursor = base
            return (
              <g key={`${c.label}-${ci}`} data-column={c.label}>
                {series.map((sr, si) => {
                  const v = c.values[si] ?? 0
                  const h = Math.round((v / top) * plotH)
                  if (h <= 0) return null
                  cursor -= h
                  return <rect key={sr.key} className={`seg ct-${sr.tone}`} x={cx} y={cursor} width={BAR} height={h} data-series={sr.key} data-value={v} />
                })}
              </g>
            )
          })}
          {threshold !== undefined && (
            <line
              className="chart-threshold"
              x1={0}
              x2={width}
              y1={base - Math.round((threshold / top) * plotH)}
              y2={base - Math.round((threshold / top) * plotH)}
              data-threshold={threshold}
            />
          )}
        </g>
        {columns.map((c, ci) => {
          if (!shown.includes(ci)) return null
          const alt = shown.indexOf(ci) % 2 === 1
          const { x, anchor } = edgeSafeLabel(ci, shown, (PAD + ci * pitch + BAR / 2) * s, width * s)
          return (
            <text
              key={`t-${c.label}-${ci}`}
              className={`chart-label${alt ? ' chart-label-alt' : ''}`}
              x={x}
              y={drawHeight * s - 2}
              textAnchor={anchor}
              fontSize={CHART_LABEL_PX}
            >
              {fitLabel(c.label, (slim && !alt ? 2 : 1) * pitch * s, CHART_LABEL_PX)}
            </text>
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

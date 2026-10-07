import { CHART_LABEL_PX, edgeSafeLabel, usableScale } from './labelScale'
import type { ChartSeries } from './types'
import { useChartScale } from './useChartScale'
import { useCallback, useEffect, useRef, useState } from 'react'
import './charts.css'

/** The well's content width (0 until measured, or without ResizeObserver: jsdom). */
function useWellWidth(on: boolean): { ref: (el: HTMLElement | null) => void; width: number } {
  const el = useRef<HTMLElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const e = el.current
    if (!on || !e || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(es => setWidth(es[0]?.contentRect.width ?? 0))
    ro.observe(e)
    return () => ro.disconnect()
  }, [on])
  const ref = useCallback((e: HTMLElement | null) => { el.current = e }, [])
  return { ref, width }
}

export interface LineSeries extends ChartSeries { points: (number | null)[] }
export type MarkerKind = 'now' | 'slide' | 'shift'
export interface LineMarker { at: number; kind: MarkerKind; label: string }

const STEP = 8
const PAD = 6
const TOP = 8
const BOTTOM = 12

/**
 * `size`: draw at least this intrinsic size (CSS px); when the well is narrower the chart keeps its size and
 * scrolls inside it (ui-progress P1 #2 burn-up: 720 x 220). UAT r3 J2: in a wider well it stretches its plot
 * across the whole width (the burn-up used to sit in the middle third of its frame), still at its height and
 * with its labels at their pixel size. Without `size`, the chart fills the well's width.
 */
export function SteppedLine({
  series, markers = [], label, height: fluidHeight = 120, max, size,
}: { series: LineSeries[]; markers?: LineMarker[]; label: string; height?: number; max?: number; size?: { width: number; height: number } }) {
  const n = Math.max(1, ...series.map(s => s.points.length))
  const height = size?.height ?? fluidHeight
  const well = useWellWidth(!!size)
  const drawW = size ? Math.max(size.width, Math.floor(well.width)) : 0
  const step = size ? (drawW - PAD * 2) / n : STEP
  const values = series.flatMap(s => s.points.filter((v): v is number => v !== null))
  const top = Math.max(1, max ?? Math.max(0, ...values))
  const width = size ? drawW : PAD * 2 + n * step
  const plotH = height - TOP - BOTTOM
  const x = (i: number) => PAD + i * step
  const y = (v: number) => TOP + plotH - Math.round((v / top) * plotH)
  const pathOf = (pts: (number | null)[]) => {
    const parts: string[] = []
    let drawing = false
    pts.forEach((v, i) => {
      if (v === null) {
        drawing = false
        return
      }
      parts.push(drawing ? `V${y(v)} H${x(i + 1)}` : `M${x(i)} ${y(v)} H${x(i + 1)}`)
      drawing = true
    })
    return parts.join(' ')
  }
  const shown = Array.from({ length: n }, (_, i) => i).filter(i => i % 12 === 0)
  const { ref, scale } = useChartScale(width)
  const s = usableScale(scale)
  return (
    <figure className={size ? 'chart-well chart-well-fixed sc' : 'chart-well'} ref={well.ref}>
      <svg
        ref={ref} className={size ? 'chart chart-fixed' : 'chart'} viewBox={`0 0 ${width * s} ${height * s}`} role="img" aria-label={label}
        style={size ? { width: drawW, height: size.height } : undefined}
      >
        <g transform={`scale(${s})`}>
        <line className="chart-axis" x1={PAD} x2={width - PAD} y1={TOP + plotH} y2={TOP + plotH} />
        {markers.map((m, i) => {
          const mx = x(m.at - 1) + step / 2
          return (
            <line key={`${m.kind}-${m.at}-${i}`} className={`chart-mark mk-${m.kind}`} x1={mx} x2={mx} y1={TOP} y2={TOP + plotH} data-marker={m.kind}>
              <title>{m.label}</title>
            </line>
          )
        })}
        {series.map(sr => (
          <path key={sr.key} className={`line ct-${sr.tone}`} d={pathOf(sr.points)} data-series={sr.key} />
        ))}
        </g>
        {shown.map(i => {
          const { x: lx, anchor } = edgeSafeLabel(i, shown, x(i) * s, width * s)
          return (
            <text key={i} className="chart-label" x={lx} y={height * s - 2} textAnchor={anchor} fontSize={CHART_LABEL_PX}>S{i + 1}</text>
          )
        })}
      </svg>
      <figcaption className="chart-legend">
        {series.map(sr => (
          <span key={sr.key} className="legend-item"><i className={`legend-swatch ct-${sr.tone}`} />{sr.label}</span>
        ))}
        {markers.some(m => m.kind === 'now') && <span className="legend-item"><i className="legend-swatch mk-now-swatch" />NOW</span>}
      </figcaption>
    </figure>
  )
}

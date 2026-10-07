import { CHART_LABEL_PX, usableScale } from './labelScale'
import { useChartScale } from './useChartScale'
import './charts.css'

const N = 5 // 5×5 frame → 16 perimeter cells
const CELL = 10
const STEP = 12

function perimeter(): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let x = 0; x < N; x++) out.push([x, 0])
  for (let y = 1; y < N; y++) out.push([N - 1, y])
  for (let x = N - 2; x >= 0; x--) out.push([x, N - 1])
  for (let y = N - 2; y >= 1; y--) out.push([0, y])
  return out
}
const CELLS = perimeter()

export function Ring({ done, total, label, testId }: { done: number; total: number; label: string; testId?: string }) {
  const pct = total ? done / total : 0
  const lit = Math.round(pct * CELLS.length)
  const size = 2 + N * STEP
  const { ref, scale } = useChartScale(size)
  const s = usableScale(scale)
  return (
    <figure className="chart-well ring" data-testid={testId}>
      <svg ref={ref} className="ring-svg" viewBox={`0 0 ${size * s} ${size * s}`} role="img" aria-label={`${label}: ${done} of ${total}`}>
        <g transform={`scale(${s})`}>
          {CELLS.map(([x, y], i) => (
            <rect key={i} className={`ring-cell${i < lit ? ' on' : ''}`} x={2 + x * STEP} y={2 + y * STEP} width={CELL} height={CELL} />
          ))}
        </g>
        <text className="ring-pct" x={(size / 2) * s} y={(size / 2) * s + CHART_LABEL_PX / 3} textAnchor="middle" fontSize={CHART_LABEL_PX}>{Math.round(pct * 100)}%</text>
      </svg>
      <figcaption className="ring-cap">
        <span className="ring-label">{label}</span>{' '}
        <span className="ring-count" data-testid={testId ? `${testId}-count` : undefined}>{done}/{total}</span>
      </figcaption>
    </figure>
  )
}

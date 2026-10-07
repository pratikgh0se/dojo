import { LENSES } from '../../ai/types'
import type { DesignSession } from '../../data/types'
import { cssVar } from '../../lib/cssVar'
import { lensSeries, sparkLabel } from '../../rules/designEvidence'
import { LENS_LABELS } from '../../rules/designSession'
import { SrChart } from '../../ui/engines/SrChart'

/** Seven stepped sparklines over sessions (charts.js `sparkline`; one value is padded to two points). */
export function LensTrend({ done }: { done: DesignSession[] }) {
  const series = lensSeries(done)
  const color = cssVar('--sr-energy-accent') || 'orange'
  return (
    <div className="ev-trend" data-testid="lens-trend">
      <h3 className="ev-title">Lens trend</h3>
      <ul className="ev-sparks">
        {LENSES.map(l => {
          const v = series[l]
          return (
            <li key={l} className="ev-spark">
              <span className="ev-spark-name" aria-hidden="true">{LENS_LABELS[l]}</span>
              <div className="ev-spark-well" role="img" aria-label={sparkLabel(l, v)} data-testid={`lens-spark-${l}`}>
                {v.length > 0
                  ? <SrChart type="sparkline" decorative data={{ values: v.length === 1 ? [v[0], v[0]] : v }} opts={{ min: 0, colors: [color] }} />
                  : <span className="empty">No sessions yet</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

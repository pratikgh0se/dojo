import { cssVar } from '../../lib/cssVar'
import { radarData, radarJson, radarLabel, type LensValues } from '../../rules/designEvidence'
import { SrChart } from '../../ui/engines/SrChart'
import './evidence.css'

/** charts.js `radial`: last 6 sessions (accent) over the all-time mean (mid); values in the accessible name and data-*. */
export function LensRadar({
  stats, count, testId = 'lens-radar',
}: { stats: { last6: LensValues; mean: LensValues }; count: number; testId?: string }) {
  const colors = [cssVar('--sr-edge-mid') || 'gray', cssVar('--sr-energy-accent') || 'orange']
  return (
    <figure
      className="ev-radar" data-testid={testId} role="img" aria-label={radarLabel(stats, count)}
      data-last6={JSON.stringify(radarJson(stats.last6, count))} data-mean={JSON.stringify(radarJson(stats.mean, count))}
    >
      <div className="ev-radar-well">
        <SrChart type="radial" decorative data={radarData(stats, count)} opts={{ colors }} />
      </div>
      {count === 0
        ? <figcaption className="empty">No sessions yet</figcaption>
        : <figcaption className="ev-legend"><i className="ev-key ev-key-last" />last 6 <i className="ev-key ev-key-mean" />all-time</figcaption>}
    </figure>
  )
}

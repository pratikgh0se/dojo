import { parseLocalDate } from '../../lib/dates'
import { fmtDayMonYear } from '../../lib/fmtDate'
import { STATUS_LABEL, STATUS_ORDER, type ArtifactRecord } from '../../rules/artifacts'
import { timelineRows } from '../../rules/artifactTimeline'
import { StackedColumns, type ChartSeries } from '../../ui/charts'
import { REGION_IDS, Region } from './Region'

const SERIES: ChartSeries[] = [
  { key: 'not started', label: 'Not started', tone: 'muted' },
  { key: 'building', label: 'Building', tone: 'rival' },
  { key: 'runs', label: 'Runs', tone: 'warn' },
  { key: 'measured', label: 'Measured', tone: 'accent' },
  { key: 'written up', label: 'Written up', tone: 'ok' },
]

/** R5 (C-PROJECTS §2.9): block-style stacked columns per sprint plus the same numbers as a table. */
export function ArtifactTimeline({
  artifacts, startDate, nowMs, lastSprint,
}: { artifacts: ArtifactRecord[]; startDate: string; nowMs: number; lastSprint: number }) {
  const rows = timelineRows(artifacts, startDate, nowMs, lastSprint)
  return (
    <Region id={REGION_IDS.timeline} title="Artifact timeline" testId="ai-timeline">
      {rows.length === 0 ? (
        <p className="empty">{startDate ? `Starts ${fmtDayMonYear(parseLocalDate(startDate))}` : 'Set a start date to begin.'}</p>
      ) : (
        <div className="p-timeline">
          <StackedColumns
            label="Artifacts by status at the end of each sprint"
            series={SERIES}
            columns={rows.map(r => ({ label: `S${r.sprint}`, values: STATUS_ORDER.map(s => r.counts[s]) }))}
            height={120}
          />
          <div className="p-scroll sc">
            <table className="p-table p-table-compact" aria-label="Artifact timeline data" data-testid="ai-timeline-table">
              <thead>
                <tr>
                  <th scope="col">Sprint</th>
                  {STATUS_ORDER.map(s => <th key={s} scope="col">{STATUS_LABEL[s]}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.sprint}>
                    <td>S{r.sprint}</td>
                    {STATUS_ORDER.map(s => <td key={s}>{r.counts[s]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Region>
  )
}

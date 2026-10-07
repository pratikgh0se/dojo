import { LADDER_SERIES, type LadderUsageRow } from '../../rules/evidence'
import { StackedColumns, type ChartSeries } from '../../ui/charts'

const SERIES: ChartSeries[] = LADDER_SERIES.map(s => ({ key: s.key, label: s.label, tone: s.tone }))

/** PLATFORM "the honesty chart": sessions per sprint by deepest rung. Target of every "See the honesty chart" link. */
export function HelpLadderUsage({ rows }: { rows: LadderUsageRow[] }) {
  return (
    <section id="help-ladder" className="sr-panel progress-help-ladder" aria-label="Help ladder usage" data-testid="progress-help-ladder">
      <h2 className="sr-panel-title">Help ladder usage</h2>
      {rows.length === 0 ? (
        <p className="empty" data-testid="help-ladder-empty">No sessions yet</p>
      ) : (
        <>
          <StackedColumns label="Sessions per sprint by deepest rung reached" series={SERIES} columns={rows.map(r => ({ label: `S${r.sprint}`, values: [...r.counts] }))} />
          <div className="table-scroll sc">
            <table className="ladder-usage-table" aria-label="Help ladder usage data" data-testid="help-ladder-table">
              <thead><tr><th scope="col">Sprint</th>{LADDER_SERIES.map(s => <th key={s.key} scope="col">{s.label}</th>)}</tr></thead>
              <tbody>{rows.map(r => <tr key={r.sprint}><td>{`S${r.sprint}`}</td>{r.counts.map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

import { cssVar } from '../../lib/cssVar'
import { type DesignTierView, type DesignTotals } from '../../rules/designs'
import { tierShort } from '../../rules/designs'
import { DIFFICULTIES, DIFFICULTY_LABELS } from '../../rules/dsa'
import { SrChart } from '../../ui/engines/SrChart'
import { Panel } from '../../ui/primitives'

/** The prototype's three Designs panels: per tier (stackedBar), 48 Sundays (pictogram), difficulty (groupedColumn). */
export function DesignCharts({ tiers, totals, answered }: { tiers: DesignTierView[]; totals: DesignTotals; answered: number }) {
  const accent = cssVar('--sr-energy-accent') || 'orange'
  const mid = cssVar('--sr-edge-mid') || 'gray'
  const rival = cssVar('--sr-energy-rival') || 'deepskyblue'
  const perTier = tiers.map(t => `${tierShort(t.name)} ${t.done} of ${t.total} done`).join(', ')
  const perDifficulty = DIFFICULTIES.map(k => `${DIFFICULTY_LABELS[k]} ${totals.byDifficulty[k].done} of ${totals.byDifficulty[k].total} done`).join(', ')
  return (
    <div className="dz-charts">
      <Panel title="Designs per tier" className="dz-chart">
        <div className="dz-well" role="img" aria-label={`Designs per tier: ${perTier}`} data-testid="designs-per-tier">
          <SrChart
            type="stackedBar" decorative
            data={{ series: [tiers.map(t => t.done), tiers.map(t => t.total - t.done)], labels: tiers.map(t => tierShort(t.name).toUpperCase()) }}
            opts={{ colors: [accent, mid], labelWidth: 112 }}
          />
        </div>
      </Panel>
      <Panel title="48 Sundays" className="dz-chart">
        <p className="dz-sub" data-testid="designs-sundays">{answered} deep dives answered</p>
        <div className="dz-well" role="img" aria-label={`${totals.done} of ${totals.total} designs done`}>
          <SrChart type="pictogram" decorative data={{ total: totals.total, value: totals.done }} opts={{ perRow: 12, colors: [accent] }} />
        </div>
      </Panel>
      {/* UAT J2: "Difficulty · done vs total" wrapped onto two lines; the title is one word and the key says which bar is which */}
      <Panel title="Difficulty" className="dz-chart">
        <p className="dz-sub dz-key" data-testid="designs-difficulty-key">
          <span><i className="dz-swatch dz-swatch-done" aria-hidden="true" />done</span>
          <span><i className="dz-swatch dz-swatch-total" aria-hidden="true" />total</span>
        </p>
        <div className="dz-well" role="img" aria-label={`Difficulty: ${perDifficulty}`}>
          <SrChart
            type="groupedColumn" decorative
            data={{
              series: [DIFFICULTIES.map(k => totals.byDifficulty[k].done), DIFFICULTIES.map(k => totals.byDifficulty[k].total)],
              labels: DIFFICULTIES.map(k => DIFFICULTY_LABELS[k]),
            }}
            opts={{ colors: [accent, rival] }}
          />
        </div>
      </Panel>
    </div>
  )
}

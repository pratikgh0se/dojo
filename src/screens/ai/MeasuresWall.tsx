import { pad2 } from '../../lib/dates'
import { downloadText } from '../../lib/downloadText'
import type { ArtifactRecord } from '../../rules/artifacts'
import { firstOf, measureRows, measuresMarkdown, MEASURES_FILE, measureValueText } from '../../rules/measures'
import { Button } from '../../ui/primitives'
import { REGION_IDS, Region } from './Region'

const FIRSTS = [
  { name: 'loss', label: 'First loss', testId: 'measure-first-loss' },
  { name: 'tokens/sec', label: 'First tokens/sec', testId: 'measure-first-tps' },
  { name: 'eval score', label: 'First eval score', testId: 'measure-first-eval' },
] as const
const HEADERS = ['Sprint', 'Stage', 'Artifact', 'Measure', 'Value', 'Unit'] as const

/** R6 (C-PROJECTS §2.10): firsts strip, chronological table, Markdown download. */
export function MeasuresWall({ artifacts }: { artifacts: ArtifactRecord[] }) {
  const rows = measureRows(artifacts)
  return (
    <Region
      id={REGION_IDS.measures}
      title="Measures wall"
      testId="measure-wall"
      actions={<Button data-testid="measure-export" onClick={() => downloadText(MEASURES_FILE, measuresMarkdown(rows))}>Export Markdown</Button>}
    >
      <div className="p-firsts">
        {FIRSTS.map(f => {
          const r = firstOf(rows, f.name)
          return (
            <div key={f.testId} className="sr-tile p-first">
              <span className="p-first-label">{f.label}</span>
              {/* the text is pinned (`<value> · S<n> · <title>`); the value is the big pixel type and the rest the body type, which wraps at its spaces (cu-5 P3-9) */}
              <b className="p-first-value" data-testid={f.testId}>
                {r ? <>{measureValueText(r)}<span className="p-first-src">{` · S${r.sprint} · ${r.artifact}`}</span></> : '—'}
              </b>
            </div>
          )
        })}
      </div>
      {rows.length === 0 ? (
        <p className="empty">No measures yet — add one on an artifact.</p>
      ) : (
        <div className="p-scroll sc">
          <table className="p-table" aria-label="Measures" data-testid="measure-table">
            <thead>
              <tr>{HEADERS.map(h => <th key={h} scope="col">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.artifactId}-${r.at}-${i}`}>
                  <td>S{r.sprint}</td>
                  <td>{r.stage === null ? '' : pad2(r.stage)}</td>
                  <td>{r.artifact}</td>
                  <td>{r.name}</td>
                  <td>{String(r.value)}</td>
                  <td>{r.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Region>
  )
}

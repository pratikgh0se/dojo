import { ATOM_NAMES, ATOMS, type Pattern } from '../../content/atlas'
import type { PatternCoverage } from '../../rules/approachCoverage'
import type { PatternState } from '../../rules/atlasProgress'

export const STATE_TEXT: Record<PatternState, string> = { none: 'not seen', seen: 'seen', predicted: 'predicted' }
const USE_TEXT = { ok: 'reached for', avoided: 'avoided' } as const

const PREDICTED_MARK = '✓' // ✓
const LEFT_TEXT = 'problems left to solve'
const USE_HEAD_TEXT = 'the approach you said you used: filled = reached for it, hollow = avoided it'

/**
 * The matrix (VISUALIZER "The Atlas tab"; labs contract §5.2 + addendum): 36 rows × 16 atoms, then Left and Use.
 * Prototype parity (Algorithm Atlas §01 "THE MAP · 36 PATTERNS × 16 ATOMS"): each cell is a full-size block —
 * main-picture atoms filled in the main-picture colour, side-panel atoms filled in the side-panel colour, other
 * cells the dark empty well. The learner's seen/predicted state rides on top as a small per-row marker (§5.2's
 * "spoken" state also stays on the row button's aria-describedby) so the kind colours are never hidden.
 */
export function AtlasMatrix({
  rows, states, coverage, left, selected, onSelect,
}: {
  rows: readonly Pattern[]
  states: Record<string, PatternState>
  coverage: Record<string, PatternCoverage>
  left: Record<string, number>
  selected: string | null
  onSelect: (slug: string, button: HTMLButtonElement) => void
}) {
  return (
    <section
      className="atlas-matrix-wrap sc"
      aria-label="Atlas matrix"
      data-testid="atlas-matrix"
      onScroll={e => { e.currentTarget.dataset.scrolled = e.currentTarget.scrollLeft > 0 ? 'true' : 'false' }}
    >
      <table className="atlas-matrix" aria-label="Atlas matrix">
        <colgroup>
          <col className="am-col-label" />
          {ATOMS.map(a => <col key={a} className="am-col-atom" />)}
          <col className="am-col-num" />
          <col className="am-col-num" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className="am-corner">Pattern</th>
            {ATOMS.map(a => (
              <th scope="col" key={a} className="am-atom" title={ATOM_NAMES[a]}><span>{a}</span></th>
            ))}
            <th scope="col" className="am-atom am-num" title={LEFT_TEXT}><span>Left</span></th>
            <th scope="col" className="am-atom am-num" title={USE_HEAD_TEXT}><span>Use</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(p => {
            const state = states[p.slug]
            const c = coverage[p.slug]
            return (
              <tr key={p.slug} data-testid={`atlas-row-${p.slug}`} data-state={state} data-coverage={c.state} className={selected === p.slug ? 'sel' : undefined}>
                <th scope="row" className="am-rowhead" title={p.label}>
                  <button
                    type="button"
                    title={p.label}
                    className="am-label"
                    data-row={p.slug}
                    aria-pressed={selected === p.slug}
                    aria-describedby={`atlas-state-${p.slug}`}
                    onClick={e => onSelect(p.slug, e.currentTarget)}
                  >
                    <span className="am-label-text">{p.label}</span>
                  </button>
                  <span className={`am-marker am-marker-${state}`} aria-hidden="true">{state === 'predicted' ? PREDICTED_MARK : ''}</span>
                </th>
                {ATOMS.map(a => {
                  const kind = p.main.includes(a) ? 'main' : p.side.includes(a) ? 'side' : 'none'
                  return (
                    <td key={a} data-testid={`atlas-cell-${p.slug}-${a}`} data-kind={kind}>
                      <span className="am-cube" aria-hidden="true" />
                    </td>
                  )
                })}
                <td className="am-left">{left[p.slug]}</td>
                <td className="am-use">
                  {c.state !== 'none' && (
                    <span className="am-use-cube" data-coverage={c.state} role="img" aria-label="Approach use" aria-describedby={`atlas-use-${p.slug}`} />
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="am-kind-legend">
        <span className="am-kind-legend-item"><i className="am-kind-swatch am-kind-main" aria-hidden="true" />main picture</span>
        <span className="am-kind-legend-item"><i className="am-kind-swatch am-kind-side" aria-hidden="true" />side panel</span>
        <span className="am-kind-legend-item"><i className="am-kind-swatch am-kind-none" aria-hidden="true" />not drawn</span>
        <span className="am-kind-caption">rows = how the question is solved · columns = what to draw</span>
      </div>
      {/* UAT J9: every column abbreviation, and Left / Use, in plain words */}
      <p className="am-atom-key" data-testid="atlas-atom-key">
        {ATOMS.map(a => <span key={a} className="am-atom-key-item"><b>{a}</b> {ATOM_NAMES[a]}</span>)}
        <span className="am-atom-key-item"><b>LEFT</b> {LEFT_TEXT}</span>
        <span className="am-atom-key-item"><b>USE</b> {USE_HEAD_TEXT}</span>
      </p>
      {/* Descriptions live outside the cells so a row header's text is only its label. */}
      <div hidden>
        {rows.map(p => (
          <span key={p.slug}>
            <span id={`atlas-state-${p.slug}`}>{STATE_TEXT[states[p.slug]]}</span>
            {coverage[p.slug].state !== 'none' && <span id={`atlas-use-${p.slug}`}>{USE_TEXT[coverage[p.slug].state as 'ok' | 'avoided']}</span>}
          </span>
        ))}
      </div>
    </section>
  )
}

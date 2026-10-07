import { useRef, useState, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { wallAnswered, type WallCell } from '../../rules/designEvidence'

/** 4 rows × one column per design (TRACKING §1): grey none, glow 1, ok 2; best ever. Arrow keys move, Enter opens. */
export function DeepDiveWall({ rows }: { rows: WallCell[][] }) {
  const navigate = useNavigate()
  const grid = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState<[number, number]>([0, 0])
  const cols = rows[0]?.length ?? 0
  const total = rows.reduce((a, r) => a + r.length, 0)
  const open = (c: WallCell) => { if (c.sessionId) navigate(`/designs/session/${c.designId}?session=${c.sessionId}`) }
  const move = (r: number, c: number) => {
    const rr = Math.max(0, Math.min(rows.length - 1, r))
    const cc = Math.max(0, Math.min(cols - 1, c))
    setFocus([rr, cc])
    grid.current?.querySelector<HTMLElement>(`[data-r="${rr}"][data-c="${cc}"]`)?.focus()
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>, r: number, c: number, cell: WallCell) => {
    const to: Record<string, [number, number]> = { ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1], ArrowUp: [r - 1, c], ArrowDown: [r + 1, c], Home: [r, 0], End: [r, cols - 1] }
    if (to[e.key]) { e.preventDefault(); move(...to[e.key]); return }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(cell) }
  }
  return (
    <div className="ev-wall">
      <div className="ev-head">
        <h3 className="ev-title">Deep-dive wall</h3>
        {/* UAT r3 J2: D-48's "k / 192 at 2" read as a position ("at #2"); it counts deep dives scored 2 of 2, so it says so */}
        <span className="ev-count" data-testid="wall-count" title={`${wallAnswered(rows)} of ${total} deep dives answered in full (scored 2 of 2)`}>{wallAnswered(rows)} of {total} answered in full</span>
      </div>
      <p className="ev-wall-key" data-testid="wall-key">
        <span><i className="ev-cell" aria-hidden="true" />not answered</span>
        <span><i className="ev-cell ev-glow" aria-hidden="true" />hand-wave (1)</span>
        <span><i className="ev-cell ev-ok" aria-hidden="true" />answered in full (2)</span>
        <span>one column per design, one row per deep dive</span>
      </p>
      <div className="ev-wall-well sc">
        <div ref={grid} role="grid" aria-label="Deep-dive wall" data-testid="wall-grid" className="ev-grid">
          {rows.map((row, r) => (
            <div key={r} role="row" className="ev-row">
              {row.map((cell, c) => (
                <div
                  key={cell.designId} role="gridcell" data-testid="wall-cell" data-design={cell.designId} data-dive={cell.dive}
                  data-state={cell.state} aria-label={cell.name} title={cell.name} data-r={r} data-c={c}
                  tabIndex={focus[0] === r && focus[1] === c ? 0 : -1}
                  className={`ev-cell ev-${cell.state}${cell.sessionId ? ' ev-open' : ''}`}
                  onClick={() => open(cell)} onKeyDown={e => onKey(e, r, c, cell)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

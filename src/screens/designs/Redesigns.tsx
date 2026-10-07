import { Link } from 'react-router-dom'
import { passRateText, type RedesignRow } from '../../rules/designEvidence'

/** TRACKING §1 redesign pass rate, same shape as the DSA redo queue. */
export function Redesigns({ rows, rate }: { rows: RedesignRow[]; rate: { passed: number; total: number } }) {
  return (
    <section className="ev-redesigns" data-testid="design-redesigns" aria-label="Redesigns">
      <h3 className="ev-title">Redesigns</h3>
      <p className="ev-rate" data-testid="design-redesign-rate">{passRateText(rate)}</p>
      {rows.length === 0 && <p className="empty">No redesigns queued</p>}
      <ul className="ev-redo-list">
        {rows.map(r => (
          <li key={r.sessionId} className={`ev-redo ev-redo-${r.state}`} data-testid={`design-redesign-${r.designId}`}>
            <span className="ev-redo-title">{r.title}</span>
            <span className="ev-redo-due">due {r.dueText}</span>
            <span className="chip">{r.state}</span>
            {r.readNext && <span className="ev-redo-read">Read: {r.readNext}</span>}
            {r.state === 'due' && (
              <Link to={`/designs/session/${r.designId}`} className="sr-btn sr-btn-accent" aria-label={`Start redesign: ${r.title}`}>
                Start redesign ▸
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

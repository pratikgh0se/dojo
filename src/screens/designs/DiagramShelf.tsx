import { Link } from 'react-router-dom'
import type { ShelfTier } from '../../rules/designEvidence'
import { FitDiagram } from '../../ui/engines/FitDiagram'

/** Thumbnails of the learner's canvases by tier; a thumb opens the session beside its reference. */
export function DiagramShelf({ tiers }: { tiers: ShelfTier[] }) {
  return (
    <section className="ev-shelf" data-testid="shelf" aria-label="Diagram shelf">
      <h3 className="ev-title">Diagram shelf</h3>
      {tiers.length === 0 && <p className="empty">No diagrams yet</p>}
      {tiers.map(t => (
        <div key={t.tier} className="ev-shelf-tier" data-testid={`shelf-tier-${t.tier}`}>
          <h4 className="ev-tier-name">{t.label}</h4>
          <div className="ev-thumbs">
            {t.thumbs.map(th => (
              <Link key={th.sessionId} to={`/designs/session/${th.designId}?session=${th.sessionId}`} className="ev-thumb" data-testid="shelf-thumb" aria-label={th.name}>
                <span className="ev-thumb-art" aria-hidden="true">
                  {th.nodes > 0 && <FitDiagram fit="box" data={th.canvas} view="2d" label={th.name} />}
                </span>
                <span className="ev-thumb-cap" aria-hidden="true">{th.title} · {th.date}</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}

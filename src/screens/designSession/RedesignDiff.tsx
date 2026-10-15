import { useDesignSession } from '../../data/designHooks'
import { normalizeCanvas, toEngineJson } from '../../rules/designCanvas'
import { diffDiagrams } from '../../rules/designDiff'
import { normalizeNotes } from '../../rules/designNotes'
import { DiffPanel } from './DiffPanel'

/**
 * A redesign pass starts with empty notes beside the earlier session's diff against its reference (DESIGN-73).
 * Renders nothing only while the earlier row loads or is gone; an earlier session with no reference still shows
 * `session-diff`, as one sentence with no items.
 */
export function RedesignDiff({ earlierId }: { earlierId: string }) {
  const earlier = useDesignSession(earlierId)
  if (!earlier) return null
  return (
    <div className="ds-earlier">
      <p className="ds-sub">Earlier session</p>
      {earlier.reference
        ? <DiffPanel diff={diffDiagrams(toEngineJson(normalizeCanvas(earlier.canvas), normalizeNotes(earlier.notes)), earlier.reference)} />
        : (
          <section className="sr-panel ds-diff" data-testid="session-diff" aria-label="Differences">
            <h2 className="sr-panel-title">Differences</h2>
            <p className="hint">No reference was drawn for this session.</p>
          </section>
        )}
    </div>
  )
}

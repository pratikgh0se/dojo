import { dismissDraftJob, useDraftStore } from '../data/draftJob'
import { Button } from './primitives'

/**
 * UAT J7: "Draft briefs" keeps running when you leave the Board; this small global indicator keeps
 * its progress in view everywhere else, then says how it ended until dismissed or seen on the Board.
 */
export function DraftIndicator() {
  const { job, inline } = useDraftStore()
  if (!job || job.seen || (inline.get(job.sprint) ?? 0) > 0) return null
  return (
    <div className="draft-pill" data-testid="draft-indicator" data-busy={job.busy ? 'true' : undefined}>
      <p className="draft-pill-text" role="status">{job.busy ? `Sprint ${job.sprint} · ${job.text}` : job.summary}</p>
      {!job.busy && (
        <Button variant="quiet" className="draft-pill-close" aria-label="Dismiss" onClick={dismissDraftJob}>×</Button>
      )}
    </div>
  )
}

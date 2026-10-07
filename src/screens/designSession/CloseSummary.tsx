import type { CloseAnswers } from '../../data/types'
import { NONE_OPTION } from '../../rules/designSession'

/** The close answers, read-only (score and done phases). */
export function CloseSummary({ close, dives }: { close: CloseAnswers; dives: string[] }) {
  const q4 = close.couldNotAnswer === 'none' ? NONE_OPTION : close.couldNotAnswer === null ? '–' : dives[close.couldNotAnswer]
  return (
    <section className="sr-panel ds-close-summary" aria-label="Close answers">
      <h2 className="sr-panel-title">Close</h2>
      <dl className="ds-dl">
        <dt>Hardest trade-off</dt><dd>chose {close.tradeoff.chose} over {close.tradeoff.over} because {close.tradeoff.because}</dd>
        <dt>Breaks first at 10×</dt><dd>{close.breaksAt10x}</dd>
        <dt>Data and ownership</dt><dd>{close.dataOwnership}</dd>
        <dt>Needed notes for</dt><dd>{q4}</dd>
        <dt>Read next</dt><dd>{close.readNext}</dd>
      </dl>
    </section>
  )
}

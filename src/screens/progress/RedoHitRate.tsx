import type { RedoHitRate as Rate } from '../../rules/evidence'
import { Stat } from '../../ui/Stat'

/** PLATFORM "Redo hit rate": redos passed vs failed, and XP refunded. */
export function RedoHitRate({ rate }: { rate: Rate }) {
  return (
    <section className="sr-panel progress-redo" aria-label="Redo hit rate" data-testid="progress-redo">
      <h2 className="sr-panel-title">Redo hit rate</h2>
      <div className="stat-strip">
        <Stat value={rate.passed} label="redos passed" testId="redo-passed-value" />
        <Stat value={rate.failed} label="redos failed" testId="redo-failed-value" />
        <Stat value={`+${rate.refunded} xp`} label="refunded" testId="redo-refunded-value" />
      </div>
    </section>
  )
}

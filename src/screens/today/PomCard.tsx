import { formOf } from '../../rules/forms'
import { levelOf } from '../../rules/xp'
import { PomStage } from '../../ui/engines/PomStage'
import { usePowerUp } from '../../ui/primitives'

/**
 * TODAY-50: Pom, the form card. It earns and costs nothing and holds no control. The form shown is the larger of the one the
 * XP earns and the highest one ever reached (`formMax`, TODAY-52), so it never goes down.
 */
export function PomCard({ xp, formMax }: { xp: number; formMax: number | undefined }) {
  const { active } = usePowerUp()
  const form = formOf(xp, formMax)
  const pose = active ? 'powerup' : 'idle'
  const now = Math.min(Math.max(xp, form.fromXp), form.untilXp)
  return (
    <section className="pom-card sr-panel" data-testid="today-pom" aria-label="Pom">
      <div className="pom-well" aria-hidden="true">
        <PomStage form={form.index} pose={pose} label={`Pom, form ${form.name}`} data-testid="today-pom-stage" data-form={form.index} data-pose={pose} />
      </div>
      <div className="pom-stats">
        <span className="qc-cap" data-testid="form-name">POM · {form.name}</span>
        <span className="pom-lv" data-testid="level" data-value={levelOf(xp)}>LV {levelOf(xp)}</span>
        <span className="qc-cap" data-testid="form-next">{form.nextName ? `to ${form.nextName} · ${form.toNext} XP` : 'SOVEREIGN · final form'}</span>
        {form.nextName && (
          <div className="pom-meter" role="meter" aria-label={`Progress to ${form.nextName}`} aria-valuemin={form.fromXp} aria-valuemax={form.untilXp} aria-valuenow={now}>
            {Array.from({ length: 12 }, (_, i) => <span key={i} className="pom-cube" data-on={i < form.segOn ? 'true' : 'false'} aria-hidden="true" />)}
          </div>
        )}
      </div>
    </section>
  )
}

import type { PomPose } from '../rules/vitals'
import { formOf } from '../rules/forms'
import { levelOf } from '../rules/xp'
import { PomStage } from './engines/PomStage'
import { Meter } from './primitives'

/** Vitals row · Pom panel (README-dashboard "Today" §2, prototype `hero`). */
export function Vitals({ xp, formXp = xp, possible, pose }: { xp: number; formXp?: number; possible: number; pose: PomPose }) {
  const form = formOf(formXp, possible)
  const label = form.nextName ? `to ${form.nextName} · ${form.toNext} xp` : 'SOVEREIGN · final form'
  return (
    <section className="sr-panel vitals-pom" aria-label="Pom">
      {/* shell-today-board M8: the canvas is decoration; the form is read from form-name */}
      <div className="pom-stage-well" aria-hidden="true">
        <PomStage form={form.index} pose={pose} label={`Pom, form ${form.name}`} />
      </div>
      <div className="pom-stats">
        <span className="vital-label" data-testid="form-name">Pom · {form.name}</span>
        <span className="lv-big" data-testid="level">LV {levelOf(xp)}</span>
        <span className="vh" data-testid="xp-total">{xp} XP</span>
        <div className="pom-next">
          <div className="pom-next-row vital-label" data-testid="form-next">
            {form.nextName
              ? <><span>to {form.nextName}</span><span className="pom-xp">{form.toNext} xp</span></>
              : <span>SOVEREIGN · final form</span>}
          </div>
          <Meter segments={12} on={form.segOn} label={label} />
        </div>
      </div>
    </section>
  )
}

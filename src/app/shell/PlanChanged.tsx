import { usePlanChanged } from '../../data/flatHooks'
import { Button } from '../../ui/primitives'

/**
 * One line after a migration, shown on the first page load only (SHELL-24). `usePlanChanged` marks the notice as seen the
 * first time it shows, so this is mounted once, in the shell, which never unmounts while the app runs.
 */
export function PlanChanged() {
  const { visible, dismiss } = usePlanChanged()
  if (!visible) return null
  return (
    <div className="sh-notice" role="status" data-testid="shell-plan-changed">
      <span>The plan changed with this update. Your finished work and XP are kept; some tickets were reorganised.</span>
      <Button variant="quiet" data-testid="shell-plan-changed-dismiss" onClick={dismiss}>Dismiss</Button>
    </div>
  )
}

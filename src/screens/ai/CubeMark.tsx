import type { CubeState } from '../../rules/stageCubes'
import './projects.css'

/** A block cube: named `role="img"` when it carries meaning, hidden decoration otherwise. */
export function CubeMark({ state, name, testId, size = 'md' }: { state: CubeState; name?: string; testId?: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`p-cube p-cube-${size}`}
      data-state={state}
      data-testid={testId}
      role={name ? 'img' : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : true}
    />
  )
}

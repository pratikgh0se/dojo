import type { ReactNode } from 'react'
import './projects.css'

/** DOM ids (not test ids) of the six /ai regions; the evidence tiles focus them. */
export const REGION_IDS = {
  evidence: 'ai-evidence-region',
  cubes: 'ai-cubes',
  learn: 'ai-learn',
  build: 'ai-build',
  timeline: 'ai-timeline-region',
  measures: 'ai-measures',
} as const

export function Region({
  id, title, testId, actions, className = '', children,
}: { id: string; title: string; testId: string; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={`sr-panel p-region ${className}`.trim()} aria-labelledby={`${id}-title`} data-testid={testId} tabIndex={-1}>
      <div className="p-region-head">
        <h2 id={`${id}-title`} className="sr-panel-title">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function focusRegion(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView?.({ block: 'start' })
  el.focus({ preventScroll: true })
}

import { useEffect } from 'react'
import { loadEngine } from '../../lib/engines'
import { useReadableEngine } from './useReadableEngine'

export type SrChartType = 'hpBar' | 'calendar' | 'stackedColumn' | 'stackedBar' | 'groupedColumn' | 'pictogram' | 'radial' | 'sparkline'

/** Mounts the prototype's <sr-chart> engine as-is (README-dashboard "Assets and components"). */
export function SrChart({
  type, data, opts, className, testId, label, decorative = false,
}: { type: SrChartType; data: unknown; opts?: unknown; className?: string; testId?: string; label?: string; decorative?: boolean }) {
  const ref = useReadableEngine<HTMLElement>('sr-chart')
  useEffect(() => {
    loadEngine('charts').catch(() => {})
  }, [])
  return (
    <sr-chart
      ref={ref}
      type={type}
      data={JSON.stringify(data)}
      opts={opts === undefined ? undefined : JSON.stringify(opts)}
      class={className}
      data-testid={testId}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? 'true' : undefined}
    />
  )
}

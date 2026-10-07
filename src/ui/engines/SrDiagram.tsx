import { useEffect } from 'react'
import { loadEngine } from '../../lib/engines'
import { useReadableEngine } from './useReadableEngine'

export interface SrDiagramProps {
  /** sr-diagram JSON {layout, nodes, links, zones, flows} (lab/diagram.js header) */
  data: unknown
  type?: 'graph' | 'sequence'
  view?: '2d' | 'iso'
  opts?: unknown
  /** animate the flows (packets along the path) */
  play?: boolean
  className?: string
  testId?: string
  label: string
}

/** Mounts the System Design Kit's <sr-diagram> engine as-is (TRACKING §1 "Draw it"). */
export function SrDiagram({ data, type = 'graph', view = '2d', opts, play, className, testId, label }: SrDiagramProps) {
  const ref = useReadableEngine<HTMLElement>('sr-diagram')
  useEffect(() => {
    loadEngine('diagram').catch(() => {})
  }, [])
  return (
    <sr-diagram
      ref={ref}
      type={type}
      view={view}
      data={JSON.stringify(data)}
      opts={opts === undefined ? undefined : JSON.stringify(opts)}
      play={play ? '' : undefined}
      theme="dark"
      class={className}
      data-testid={testId}
      role="group"
      aria-label={label}
    />
  )
}

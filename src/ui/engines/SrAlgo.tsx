import { forwardRef, useEffect, type Ref } from 'react'
import { loadEngine } from '../../lib/engines'
import { useReadableEngine } from './useReadableEngine'

/** The <sr-algo> / <sr-algo2> element; `model` is the parsed JSON the engine is showing. */
export type AlgoElement = HTMLElement & { model?: unknown }

export interface SrAlgoProps {
  /** 'algo' = <sr-algo> (lab/algo.js); 'algo2' = <sr-algo2>, the append-only structure pack (lab/algo2.js) */
  engine: 'algo' | 'algo2'
  /** the step-contract JSON ({title, complexity, structures, code, steps}) */
  json: unknown
  label: string
  testId?: string
  /** like SrChart's `className`: React on a custom element passes it through as a literal `classname`
   *  attribute, so the wrapper sets `class` instead (see ui/engines/elements.d.ts). */
  className?: string
}

/** Mounts the Algorithm Lab player as-is (BUILD.md "Engines as-is"; VISUALIZER "The player"). */
export const SrAlgo = forwardRef<AlgoElement, SrAlgoProps>(function SrAlgo({ engine, json, label, testId, className }, ref) {
  const own = useReadableEngine<HTMLElement>(engine === 'algo' ? 'sr-algo' : 'sr-algo2', ref as never)
  useEffect(() => {
    loadEngine(engine).catch(() => {})
  }, [engine])
  const r = own as Ref<HTMLElement>
  const data = JSON.stringify(json)
  return engine === 'algo'
    ? <sr-algo ref={r} data={data} theme="dark" class={className} data-testid={testId} role="group" aria-label={label} />
    : <sr-algo2 ref={r} data={data} theme="dark" class={className} data-testid={testId} role="group" aria-label={label} />
})

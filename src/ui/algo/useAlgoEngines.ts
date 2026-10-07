import { useCallback, useEffect, useState } from 'react'
import { loadAlgoEngines } from '../../lib/engines'

export type EngineState = 'loading' | 'ready' | 'error'

/** Loads algo.js, algo2.js and atlas-pieces.js once; `retry` re-requests after a failure. */
export function useAlgoEngines(): { state: EngineState; retry: () => void } {
  const [state, setState] = useState<EngineState>('loading')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let live = true
    setState('loading')
    loadAlgoEngines().then(
      () => live && setState('ready'),
      () => live && setState('error'),
    )
    return () => {
      live = false
    }
  }, [attempt])
  const retry = useCallback(() => setAttempt(a => a + 1), [])
  return { state, retry }
}

import { useCallback, useRef } from 'react'
import { safeWrite } from '../../data/safeWrite'

/** Serialises IndexedDB writes so a later change never lands before an earlier one; `flush` waits for all. */
export function useWriteQueue(onError: (m: string) => void): { push: (job: () => Promise<unknown>) => void; flush: () => Promise<void> } {
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const push = useCallback((job: () => Promise<unknown>) => {
    chain.current = chain.current.then(() => safeWrite(job, onError)).catch(() => onError('Could not save the session'))
  }, [onError])
  const flush = useCallback(() => chain.current.then(() => undefined), [])
  return { push, flush }
}

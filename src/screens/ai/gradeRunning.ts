import { useSyncExternalStore } from 'react'

/**
 * Whether a grade job is in flight, keyed by artifact id, kept at module scope (not component
 * state) so the button stays disabled if the artifact dialog is closed and reopened while its
 * grade request is still running (chain P task 5).
 */
const runningIds = new Set<string>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const l of listeners) l()
}

export function isGradeRunning(id: string): boolean {
  return runningIds.has(id)
}

export function setGradeRunning(id: string, value: boolean): void {
  const had = runningIds.has(id)
  if (value === had) return
  if (value) runningIds.add(id)
  else runningIds.delete(id)
  notify()
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => listeners.delete(onChange)
}

export function useGradeRunning(id: string): boolean {
  return useSyncExternalStore(subscribe, () => isGradeRunning(id))
}

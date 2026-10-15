import { useLayoutEffect, useSyncExternalStore } from 'react'

/**
 * Ruling 23 K1: the shortcuts list is truthful per screen. The destination keys (1 to 6) are global and listed by the
 * shortcuts overlay itself; the keys a screen answers (Enter, F, D, Space) are published here while that screen answers
 * them, and the overlay prints them under "On this screen". A key that means nothing on a screen is not listed.
 */

const NONE: readonly string[] = []
let keys: readonly string[] = NONE
const subs = new Set<() => void>()

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i])

function setScreenKeys(next: readonly string[]) {
  if (same(keys, next)) return
  keys = next
  subs.forEach(f => f())
}

/** A screen's own keys, for as long as it is mounted (and while `next` says so). */
export function useScreenKeys(next: readonly string[]): void {
  const sig = next.join('|')
  useLayoutEffect(() => {
    setScreenKeys(next)
    return () => setScreenKeys(NONE)
    // `sig` stands for `next`: the arrays are constants or rebuilt each render
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps
}

export function useLegendKeys(): readonly string[] {
  return useSyncExternalStore(
    cb => { subs.add(cb); return () => { subs.delete(cb) } },
    () => keys,
    () => NONE,
  )
}

import { useLayoutEffect, useSyncExternalStore } from 'react'

/**
 * Ruling 23 K1: the footer legend is truthful per screen. The tab keys are global; the keys a screen itself answers
 * (Enter, space, d, s, Shift+arrows) are listed only while that screen answers them, so a screen publishes them here
 * and the Shell prints them after the global ones. A key that means nothing on a screen is not on its legend.
 */
export const GLOBAL_KEYS = '1–9, 0 tabs · a atlas · b banks · m more · t today'

/** Today, with a NOW item: Enter opens it, space starts or pauses its timer, d marks it done, s slides it. */
export const TODAY_KEYS: readonly string[] = ['Enter start', 'space timer', 'd done', 's slide']
/** Board, the card itself focused. */
export const BOARD_CARD_KEYS: readonly string[] = ['Enter open', 'Shift+←/→ move', 'd done', 's slide']
/** Board, a control inside a card focused (Enter then belongs to that control). */
export const BOARD_INSIDE_KEYS: readonly string[] = ['Shift+←/→ move', 'd done', 's slide']

const NONE: readonly string[] = []
let keys: readonly string[] = NONE
const subs = new Set<() => void>()

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i])

function setScreenKeys(next: readonly string[]) {
  if (same(keys, next)) return
  keys = next
  subs.forEach(f => f())
}

/** The legend line for the keys a screen publishes. */
export function legendText(screenKeys: readonly string[] = NONE): string {
  return [GLOBAL_KEYS, ...screenKeys].join(' · ')
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

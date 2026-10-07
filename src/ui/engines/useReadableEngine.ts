import { useLayoutEffect, useRef } from 'react'
import { adoptReadable, fitEngineDrawings } from '../../lib/engineType'

/**
 * Ref for an engine element: once its tag is defined (the engine script may load after this mounts, e.g.
 * after navigation) the readable-type sheet is adopted into its shadow root, before paint where possible.
 */
export function useReadableEngine<T extends HTMLElement>(tag: string, forwarded?: { current: T | null } | ((el: T | null) => void) | null) {
  const ref = useRef<T | null>(null)
  const set = (el: T | null) => {
    ref.current = el
    if (typeof forwarded === 'function') forwarded(el)
    else if (forwarded) forwarded.current = el
  }
  useLayoutEffect(() => {
    let live = true
    const el = ref.current
    if (!el) return
    adoptReadable(el)
    let unfit = () => {}
    const fits = tag === 'sr-algo' || tag === 'sr-algo2'
    void customElements.whenDefined(tag).then(() => {
      if (!live || !el.isConnected) return
      adoptReadable(el)
      if (fits) unfit = fitEngineDrawings(el)
      // an engine that builds its shadow root a beat after upgrade
      requestAnimationFrame(() => { if (live) adoptReadable(el) })
    })
    return () => { live = false; unfit() }
  }, [tag])
  return set
}

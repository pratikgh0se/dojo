import { useEffect } from 'react'
import { useNavigateAfterWrites } from '../data/useNavigateAfterWrites'

/** The Mac app's native menu (electron/menu.mjs, ruling 23 K4) asks the page to open a screen with this event. */
export const NAVIGATE_EVENT = 'dojo:navigate'

/** An in-app path only: "/settings", never a URL or a protocol-relative "//host". */
const inApp = (v: unknown): v is string => typeof v === 'string' && /^\/(?!\/)/.test(v)

export function useNativeNavigation(): void {
  const go = useNavigateAfterWrites()
  useEffect(() => {
    const on = (e: Event) => {
      const to = (e as CustomEvent).detail
      if (inApp(to)) go(to)
    }
    window.addEventListener(NAVIGATE_EVENT, on)
    return () => window.removeEventListener(NAVIGATE_EVENT, on)
  }, [go])
}

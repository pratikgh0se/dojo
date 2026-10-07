import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { waitForPendingWrites } from './safeWrite'

/** I1: a write that never settles (e.g. a blocked Dexie open) must not block navigation forever -
 * every tab link, More item, shortcut and "Open in Atlas" races the wait against this cap. */
export const NAVIGATE_WRITE_TIMEOUT_MS = 1500

const afterWritesOrTimeout = (): Promise<void> =>
  Promise.race([waitForPendingWrites(), new Promise<void>(r => setTimeout(r, NAVIGATE_WRITE_TIMEOUT_MS))])

/** In-app navigation that first lets every in-flight safeWrite land (a warm-up's seen/predict row),
 * so the next screen reads it. Resolves at once when nothing is pending (integration spec §7), and
 * navigates anyway after NAVIGATE_WRITE_TIMEOUT_MS when a write never settles. */
export function useNavigateAfterWrites(): (to: string) => void {
  const navigate = useNavigate()
  return useCallback((to: string) => { void afterWritesOrTimeout().then(() => navigate(to)) }, [navigate])
}

/** Only a plain left click is taken over; modifier clicks keep the browser's new-tab behaviour. */
export function isPlainClick(e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }): boolean {
  return e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented
}

import { useEffect, useState } from 'react'

/** Ruling 9: a screen that is still reading shows "Loading…" only after this long, so a quick read never flashes it. */
export const LOADING_DELAY_MS = 300

/**
 * The screens' "still reading" line (UAT r3 J2: Today and AI flashed "Loading…" for a frame or two on every visit).
 * The `.loading` element is there at once (Screen's data-ready waits for it to go); its text only after 300 ms.
 */
export function Loading({ text = 'Loading…' }: { text?: string }) {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), LOADING_DELAY_MS)
    return () => clearTimeout(t)
  }, [])
  return <p className="loading" role="status" aria-busy="true">{shown ? text : ''}</p>
}

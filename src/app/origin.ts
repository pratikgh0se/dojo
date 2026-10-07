import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

// UAT J7: Do's "‹ Back" (and Esc) returns to the screen the Do screen was opened from (Week, DSA, Today, …),
// not always the Board. The Shell notes every screen with a header; Back goes back through the history to it
// (a POP, so that screen keeps where it was scrolled). A Do screen opened directly (a link, a reload) goes to
// the Board, as before.
let origin: { path: string; idx: number | null } | null = null

function historyIdx(): number | null {
  const s = (typeof window === 'undefined' ? null : window.history.state) as { idx?: unknown } | null
  return typeof s?.idx === 'number' ? s.idx : null
}

/** The Shell calls this for every screen that is not full-screen (Do, a design session). */
export function noteScreen(path: string): void {
  origin = { path, idx: historyIdx() }
}

/** Test hook. */
export function resetOrigin(): void {
  origin = null
}

export function useLeaveDo(): () => void {
  const navigate = useNavigate()
  return useCallback(() => {
    const o = origin
    const here = historyIdx()
    if (o && o.idx !== null && here !== null && here > o.idx) navigate(o.idx - here)
    else navigate(o?.path ?? '/board')
  }, [navigate])
}

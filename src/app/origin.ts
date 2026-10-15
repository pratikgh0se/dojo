import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

// UAT J7: Do's "‹ Back" (and Esc) returns to the screen the Do screen was opened from (Week, DSA, Today, …),
// not always Today. The Shell notes every screen with a header; Back goes back through the history to it
// (a POP, so that screen keeps where it was scrolled). A Do screen opened directly (a link) goes to Today.
// TICKET-01: the remembered screen also lives in sessionStorage, so a Do screen loaded afresh in the same tab (a reload, an address-bar
// load after /path) still goes back to the screen the tab was last on, instead of Today.
let origin: { path: string; idx: number | null } | null = null
const ORIGIN_KEY = 'dojo-origin'

function historyIdx(): number | null {
  const s = (typeof window === 'undefined' ? null : window.history.state) as { idx?: unknown } | null
  return typeof s?.idx === 'number' ? s.idx : null
}

function stored(): { path: string; idx: number | null } | null {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(ORIGIN_KEY) ?? 'null')
    const o = v as { path?: unknown; idx?: unknown } | null
    // idx is dropped on purpose: history indexes restart at 0 in every document, so a stored one means nothing after a fresh load
    return o && typeof o.path === 'string' && o.path.startsWith('/') ? { path: o.path, idx: null } : null
  } catch {
    return null
  }
}

/** The Shell calls this for every screen that is not full-screen (Do, a design session). */
export function noteScreen(path: string): void {
  origin = { path, idx: historyIdx() }
  try { sessionStorage.setItem(ORIGIN_KEY, JSON.stringify(origin)) } catch { /* storage off: the in-memory origin still works */ }
}

/** Test hook. */
export function resetOrigin(): void {
  origin = null
  try { sessionStorage.removeItem(ORIGIN_KEY) } catch { /* nothing stored */ }
}

export function useLeaveDo(): () => void {
  const navigate = useNavigate()
  return useCallback(() => {
    const o = origin ?? stored()
    const here = historyIdx()
    if (o && o.idx !== null && here !== null && here > o.idx) navigate(o.idx - here)
    else navigate(o?.path ?? '/')
  }, [navigate])
}

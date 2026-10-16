import { useEffect, useState } from 'react'
import { now } from './clock'

/** What a clock with no running timer uses: the minute keeps the day and headings fresh. */
export const IDLE_TICK_MS = 60_000

/**
 * Re-reads the clock while mounted and calls `set` when `intervalMs` has passed, and at once when the clock jumped (forwards or
 * back): a tester fixes the browser clock after the page loaded (README "Fixed clock"), and a screen that waited for its next 60 s
 * tick would keep showing the old day. A period longer than a second is still CHECKED every second; the check sets no state.
 */
function watchClock(intervalMs: number, set: (t: number) => void): () => void {
  let last = now()
  set(last)
  const poll = Math.min(intervalMs, 1000)
  const iv = window.setInterval(() => {
    const at = now()
    if (poll === intervalMs || at < last || at - last >= intervalMs) {
      last = at
      set(at)
    }
  }, poll)
  return () => window.clearInterval(iv)
}

/** The clock, refreshed every `intervalMs`. Ask for 1000 only for a visible running timer; everything else wants a minute. */
export function useNow(intervalMs: number): number {
  const [t, setT] = useState(() => now())
  useEffect(() => watchClock(intervalMs, setT), [intervalMs])
  return t
}

/**
 * A clock for a countdown that started at `anchor`: it ticks on the anchor's own second boundaries (anchor + 1 s, + 2 s ...), not on
 * a one-second interval started whenever the component happened to mount. A fixed-period interval started some milliseconds before
 * the anchor reads each second late, so the first reading after Start repeats 45:00 instead of dropping (DESIGN-06). Each tick plans
 * the next one from the clock itself, so a late or early timer corrects on the following tick. With no anchor it ticks every `idleMs`
 * (default one second; pass `IDLE_TICK_MS` when nothing is counting), still following a clock jump within a second.
 */
export function useSecondsNow(anchor: number | null | undefined, idleMs = 1000): number {
  const [t, setT] = useState(() => now())
  useEffect(() => {
    if (anchor == null) return watchClock(idleMs, setT)
    setT(now())
    const untilNextSecond = (at: number) => 1000 - ((((at - anchor) % 1000) + 1000) % 1000)
    let timer = 0
    const tick = () => {
      const at = now()
      setT(at)
      timer = window.setTimeout(tick, untilNextSecond(at))
    }
    timer = window.setTimeout(tick, untilNextSecond(now()))
    return () => window.clearTimeout(timer)
  }, [anchor, idleMs])
  return t
}

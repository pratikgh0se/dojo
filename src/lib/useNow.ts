import { useEffect, useState } from 'react'
import { now } from './clock'

/**
 * The clock, refreshed every `intervalMs`. A period longer than a second is still checked every second, and it moves on early when the
 * clock jumped (forwards or back): a tester fixes the browser clock after the page loaded (README "Fixed clock"), and a screen that
 * waited for its next 60 s tick would keep showing the old day.
 */
export function useNow(intervalMs = 1000): number {
  const [t, setT] = useState(() => now())
  useEffect(() => {
    let last = now()
    setT(last)
    const poll = Math.min(intervalMs, 1000)
    const iv = window.setInterval(() => {
      const at = now()
      if (poll === intervalMs || at < last || at - last >= intervalMs) {
        last = at
        setT(at)
      }
    }, poll)
    return () => window.clearInterval(iv)
  }, [intervalMs])
  return t
}

/**
 * A clock for a countdown that started at `anchor`: it ticks on the anchor's own second boundaries (anchor + 1 s, + 2 s ...), not on
 * a one-second interval started whenever the component happened to mount. A fixed-period interval started some milliseconds before
 * the anchor reads each second late, so the first reading after Start repeats 45:00 instead of dropping (DESIGN-06). Each tick plans
 * the next one from the clock itself, so a late or early timer corrects on the following tick. Without an anchor it ticks every second.
 */
export function useSecondsNow(anchor: number | null | undefined): number {
  const [t, setT] = useState(() => now())
  useEffect(() => {
    setT(now())
    if (anchor == null) {
      const iv = window.setInterval(() => setT(now()), 1000)
      return () => window.clearInterval(iv)
    }
    const untilNextSecond = (at: number) => 1000 - ((((at - anchor) % 1000) + 1000) % 1000)
    let timer = 0
    const tick = () => {
      const at = now()
      setT(at)
      timer = window.setTimeout(tick, untilNextSecond(at))
    }
    timer = window.setTimeout(tick, untilNextSecond(now()))
    return () => window.clearTimeout(timer)
  }, [anchor])
  return t
}

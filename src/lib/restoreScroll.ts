// Back / Forward returns a screen to where it was scrolled (Shell). A screen that fills in after it mounts (the DSA bank waits for
// its tickets, then draws the topic detail) is still short on the first frame, and a single scroll there stops at the end of the
// short page: the learner came back to a different place each time (UAT cu-5 P3-5). So the position is asked for again every frame
// until the page is long enough to hold it, for at most `maxMs`, and the moment the learner scrolls or types themselves it stops.

const USER_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const

/** Scrolls `win` to `y` as soon as the page can reach it; returns a function that stops asking. */
export function restoreScroll(y: number, win: Window = window, maxMs = 1500): () => void {
  let frame = 0
  let done = false
  const started = performance.now()
  const stop = () => {
    if (done) return
    done = true
    cancelAnimationFrame(frame)
    for (const e of USER_EVENTS) win.removeEventListener(e, stop)
  }
  const tick = () => {
    if (done) return
    win.scrollTo(0, y)
    if (Math.abs(win.scrollY - y) <= 1 || performance.now() - started >= maxMs) return stop()
    frame = requestAnimationFrame(tick)
  }
  for (const e of USER_EVENTS) win.addEventListener(e, stop, { passive: true })
  frame = requestAnimationFrame(tick)
  return stop
}

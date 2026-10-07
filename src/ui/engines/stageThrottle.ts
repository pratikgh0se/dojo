// perf diagnostic P2: <pom-stage> (frozen engine) renders WebGL on every animation frame forever (120 fps on a
// ProMotion display). The engine stays byte-identical; this wraps the element's own `_tick` so that it
//   - draws at most 30 frames a second,
//   - stops while the window is hidden, after IDLE_MS without user input, and with reduced motion
//     (one frame is still drawn whenever something changes, so the avatar is never blank or stale),
//   - wakes on input, on becoming visible, on any attribute change (form, pose) and on a resize (the engine clears its canvas).
export const FRAME_MS = 1000 / 30
export const IDLE_MS = 10_000

type Stage = HTMLElement & { _tick?: () => void; _alive?: boolean; _raf?: number; _last?: number }

export function throttleStage(el: Stage, reducedMotion: () => boolean): () => void {
  const proto = Object.getPrototypeOf(el) as { _tick?: () => void }
  const base = proto._tick
  if (typeof base !== 'function') return () => {}
  let due = 0 // when the next frame may draw: a 30 fps budget whatever the display's refresh rate
  let lastInput = performance.now()
  let sleeping = false
  let needFrame = true
  const paused = () => reducedMotion() || document.hidden || performance.now() - lastInput > IDLE_MS
  el._tick = function tick(this: Stage) {
    if (!el._alive) return
    const now = performance.now()
    if (paused()) {
      if (!needFrame) { sleeping = true; return }
      needFrame = false
      due = now + FRAME_MS
      base.call(el) // draws once; its own next-frame request comes back here and sleeps
      return
    }
    if (now < due - 1) { el._raf = requestAnimationFrame(() => el._tick?.()); return }
    due = Math.max(due, now - FRAME_MS) + FRAME_MS
    base.call(el)
  }
  const wake = (frame = false) => {
    if (frame) needFrame = true
    if (sleeping && el._alive) { sleeping = false; el._last = performance.now(); el._tick?.() }
  }
  const onInput = () => { lastInput = performance.now(); wake() }
  const onVisible = () => { if (!document.hidden) wake(true) }
  const mo = new MutationObserver(() => { lastInput = performance.now(); wake(true) })
  mo.observe(el, { attributes: true })
  // UAT cu-r3b P3-2: a resize (View > Zoom In/Out/Actual Size, a new devicePixelRatio) makes the engine resize its canvas, which
  // clears it; while asleep nothing drew it again, so the avatar stayed empty. One frame is owed after every resize.
  const onResize = () => wake(true)
  window.addEventListener('resize', onResize)
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null
  ro?.observe(el)
  const opts = { passive: true, capture: true } as const
  for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(t, onInput, opts)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    mo.disconnect()
    ro?.disconnect()
    window.removeEventListener('resize', onResize)
    for (const t of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.removeEventListener(t, onInput, opts)
    document.removeEventListener('visibilitychange', onVisible)
    delete el._tick
  }
}

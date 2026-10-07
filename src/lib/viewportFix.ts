// sim-align F5: after the iOS keyboard closes (the visual viewport grows back), Mobile Safari can leave sticky bars
// such as the Do rail drawn under the status bar until the next scroll. When the visual viewport grows, nudge the
// scroll position by one pixel and back, which makes Safari lay the sticky elements out again.
export function installViewportFix(): () => void {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  if (!vv) return () => {}
  let last = vv.height
  const onResize = () => {
    const grew = vv.height > last + 40
    last = vv.height
    if (!grew) return
    requestAnimationFrame(() => {
      const y = window.scrollY
      window.scrollTo(window.scrollX, y + 1)
      window.scrollTo(window.scrollX, y)
    })
  }
  vv.addEventListener('resize', onResize)
  return () => vv.removeEventListener('resize', onResize)
}

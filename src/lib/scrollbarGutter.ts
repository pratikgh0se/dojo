// UAT J2: with classic, space-taking scrollbars (macOS with a mouse attached, or "Always show scroll bars"),
// the centred header jumps about 7 px between screens that scroll and screens that do not. Reserve the
// scrollbar gutter then, and only then: with overlay scrollbars, and in the e2e suite's hidden-scrollbar
// browser, the layout stays exactly as it was.

/** True when a scrolling box loses width to its scrollbar. */
export function classicScrollbars(doc: Document = document): boolean {
  const probe = doc.createElement('div')
  probe.style.cssText = 'position:absolute;top:-9999px;left:0;width:100px;height:100px;overflow:scroll;visibility:hidden'
  doc.body.appendChild(probe)
  const thickness = probe.offsetWidth - probe.clientWidth
  probe.remove()
  return thickness > 0
}

/** Marks <html class="classic-scrollbars"> (app.css reserves the gutter); re-checked on resize. */
export function installScrollbarGutter(): () => void {
  if (typeof window === 'undefined' || !document.body) return () => {}
  const apply = () => document.documentElement.classList.toggle('classic-scrollbars', classicScrollbars())
  apply()
  let frame = 0
  const onResize = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(apply)
  }
  window.addEventListener('resize', onResize)
  return () => {
    cancelAnimationFrame(frame)
    window.removeEventListener('resize', onResize)
  }
}

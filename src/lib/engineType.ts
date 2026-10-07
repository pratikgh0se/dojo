// ux spec section 1: the vendored engines (frozen prototype code, byte-identical to the handoff) draw
// labels at 9 to 13 px, partly in Silkscreen. Each engine wrapper adopts one stylesheet into its element's
// shadow root that lifts every text to the type scale: Space Mono and Chivo at 14 px or more, and no
// Silkscreen at all below 16. An author rule beats an SVG presentation attribute, and an adopted sheet
// survives the engines' own `innerHTML = ...` re-renders.
export const ENGINE_TYPE_CSS = [
  'svg text{font-size:14px;font-family:"Space Mono",ui-monospace,monospace}',
  '.code,.vars,.count,.badge,.title{font-size:14px}',
  '.vars b{font-family:Chivo,system-ui,sans-serif;font-weight:700;font-size:14px}',
  '.bar button,select{font:700 14px Chivo,system-ui,sans-serif;text-transform:uppercase}',
  '.say{font-size:15px}',
  // ui-today/ui-progress: no clipped labels. The calendar draws its month row at y=8 and the radar
  // puts its axis labels outside its square; both hosts leave room around the svg for them.
  ':host([type=calendar]) svg,:host([type=radial]) svg{overflow:visible}',
].join('')

const MARK = '__dojoReadable'

/** Append the readable-type sheet to `el`'s shadow root (once). False when there is no root or no adoptable sheets. */
export function adoptReadable(el: Element): boolean {
  const root = el.shadowRoot
  if (!root || !('adoptedStyleSheets' in root) || typeof CSSStyleSheet === 'undefined') return false
  if (root.adoptedStyleSheets.some(s => (s as unknown as Record<string, unknown>)[MARK])) return true
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(ENGINE_TYPE_CSS)
    ;(sheet as unknown as Record<string, unknown>)[MARK] = true
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
    return true
  } catch {
    return false
  }
}

type EngineHost = HTMLElement & { model?: { steps?: unknown[] } | null; k?: number; draw?: () => void }
type Box = { l: number; t: number; r: number; b: number }
/** Steps scanned up front; a longer trace extends the union as it is stepped. */
export const PRESCAN_MAX_STEPS = 600

/**
 * Controller ruling 1 (no clipped labels) and UAT J6 (one stable scale): the player engines size each frame to its
 * own content, so one step's drawing may be wider or taller than the next, and the browser then scaled some frames
 * down (labels unreadable) and moved the controls on every step. When a trace loads, every step is drawn once,
 * synchronously (no paint in between), and the union of all the frames' extents (labels included) becomes the one
 * viewBox for the whole trace, drawn 1:1 (width and height in px, max-width lifted; a wide trace scrolls inside the
 * engine's own `.stage { overflow: auto }`). Every frame then has exactly the same box. Nothing is written that
 * already holds, and the host never shrinks back by a scrollbar's height, so no fit can start a redraw loop
 * (perf diagnostic P1). The engine itself stays byte-identical to the handoff. Returns a function that stops watching.
 */
export function fitEngineDrawings(el: Element): () => void {
  const root = el.shadowRoot
  const host = el as EngineHost
  if (!root || typeof MutationObserver === 'undefined') return () => {}
  const setStyle = (e: HTMLElement | SVGElement, prop: 'width' | 'height' | 'maxWidth' | 'minHeight', v: string) => { if (e.style[prop] !== v) e.style[prop] = v }
  const setAttr = (e: Element, name: string, v: string) => { if (e.getAttribute(name) !== v) e.setAttribute(name, v) }
  const frames = () => Array.from(root.querySelectorAll<SVGSVGElement>('.stage > svg'))
  let union: Box | null = null
  let model: unknown = undefined
  let width = -1
  let scanning = false
  let minH = 0
  const extend = (svg: SVGSVGElement) => {
    try {
      const vb = svg.viewBox?.baseVal
      if (!vb || !vb.width) return
      const box = svg.getBBox()
      const f: Box = {
        l: Math.min(vb.x, Math.floor(box.x) - 4), t: Math.min(vb.y, Math.floor(box.y) - 2),
        r: Math.max(vb.x + vb.width, Math.ceil(box.x + box.width) + 4), b: Math.max(vb.y + vb.height, Math.ceil(box.y + box.height) + 2),
      }
      union = union ? { l: Math.min(union.l, f.l), t: Math.min(union.t, f.t), r: Math.max(union.r, f.r), b: Math.max(union.b, f.b) } : f
    } catch { /* not laid out yet */ }
  }
  const apply = () => {
    if (!union) return
    const w = union.r - union.l, h = union.b - union.t
    for (const svg of frames()) {
      setAttr(svg, 'viewBox', `${union.l} ${union.t} ${w} ${h}`)
      setStyle(svg, 'width', `${w}px`)
      setStyle(svg, 'height', `${h}px`)
      setStyle(svg, 'maxWidth', 'none')
      if (svg.hasAttribute('width')) setAttr(svg, 'width', String(w))
      if (svg.hasAttribute('height')) setAttr(svg, 'height', String(h))
    }
    requestAnimationFrame(() => {
      const hh = Math.ceil(host.getBoundingClientRect().height)
      if (hh > minH) { minH = hh; setStyle(host, 'minHeight', `${hh}px`) }
    })
  }
  /** Draws every step once (in one task: nothing is painted) to take the union of their extents. */
  const prescan = () => {
    const steps = host.model?.steps
    if (!Array.isArray(steps) || typeof host.draw !== 'function' || typeof host.k !== 'number') return
    scanning = true
    const k0 = host.k
    try {
      const n = Math.min(steps.length, PRESCAN_MAX_STEPS)
      for (let i = 0; i <= n; i++) { host.k = i; host.draw(); for (const svg of frames()) extend(svg) }
    } finally {
      host.k = k0
      host.draw()
      scanning = false
    }
  }
  const fit = () => {
    if (scanning) return
    const w = host.clientWidth
    if (host.model !== model || w !== width) {
      // a new trace (or a new width, which changes how the engine lays frames out): measure the whole trace again
      model = host.model
      width = w
      union = null
      prescan()
    }
    for (const svg of frames()) extend(svg) // a frame past the scanned steps can only grow the union
    apply()
  }
  const mo = new MutationObserver(fit)
  mo.observe(root, { childList: true, subtree: true })
  fit()
  return () => mo.disconnect()
}

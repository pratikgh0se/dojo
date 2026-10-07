import { useLayoutEffect, useRef, useState } from 'react'
import { SrDiagram, type SrDiagramProps } from './SrDiagram'

/** A drawing never shrinks past this in `width` mode: below it the well scrolls instead, so the text stays readable. */
export const FIT_MIN_SCALE = 0.4

/** A reference architecture is wide and its node labels are small: below this its well scrolls sideways rather than crowd them (UAT cu-r3 A9). */
export const REFERENCE_MIN_SCALE = 0.7

/** The scale a drawing of `d` draws at inside an `availW` x `availH` box (0 = not laid out yet: natural size). */
export function fitScale(d: { w: number; h: number }, availW: number, availH: number, fit: 'width' | 'box', minScale = FIT_MIN_SCALE): number {
  let s = 1
  if (availW > 0) {
    s = Math.min(1, availW / d.w)
    if (fit === 'box' && availH > 0) s = Math.min(s, availH / d.h)
    else s = Math.max(minScale, s)
  }
  return Math.floor(s * 1000) / 1000
}

/** The drawing's own size: the engine writes it on the svg (`style.width`/`height` in px, the same as its viewBox). */
function drawnSize(host: Element | null): { w: number; h: number } | null {
  const svg = host?.shadowRoot?.querySelector('svg')
  if (!svg) return null
  const vb = svg.viewBox?.baseVal
  const w = parseFloat(svg.style.width) || vb?.width || 0
  const h = parseFloat(svg.style.height) || vb?.height || 0
  return w > 0 && h > 0 ? { w, h } : null
}

/**
 * UAT cu-7 P3-5: an sr-diagram draws at its natural size, so a preview in a small box showed a fragment (the shelf's fixed 0.3
 * scale) or only part of the drawing (a phone's Your diagram). This one measures what the engine drew and scales it to fit:
 * `box` fits the whole drawing inside the box it fills (a thumbnail); `width` fits the width of its container, never past
 * 1:1 and never below FIT_MIN_SCALE (then its container scrolls). The engine is untouched; the scale is a CSS transform, so
 * Export PNG, which reads the svg itself, still gets the drawing at full size.
 */
export function FitDiagram({ fit = 'width', minScale = FIT_MIN_SCALE, ...props }: SrDiagramProps & { fit?: 'width' | 'box'; minScale?: number }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number; s: number } | null>(null)
  const data = JSON.stringify(props.data)

  useLayoutEffect(() => {
    const out = outer.current
    const inn = inner.current
    if (!out || !inn) return
    let live = true
    let mo: MutationObserver | null = null
    const measure = () => {
      const d = drawnSize(inn.querySelector('sr-diagram'))
      if (!live || !d) return
      const availW = out.clientWidth
      const availH = out.clientHeight
      const s = fitScale(d, availW, availH, fit, minScale)
      setSize(prev => (prev && prev.w === d.w && prev.h === d.h && prev.s === s ? prev : { w: d.w, h: d.h, s }))
    }
    const watch = () => {
      const root = inn.querySelector('sr-diagram')?.shadowRoot
      if (root && typeof MutationObserver !== 'undefined') {
        mo = new MutationObserver(measure)
        mo.observe(root, { childList: true })
      }
      measure()
    }
    if (typeof customElements !== 'undefined') void customElements.whenDefined('sr-diagram').then(() => { if (live) watch() })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(out)
    measure()
    return () => { live = false; mo?.disconnect(); ro?.disconnect() }
  }, [data, fit, minScale])

  const box = fit === 'box'
  return (
    <div ref={outer} className={`fit-diagram${box ? ' fit-box' : ''}`} data-fit={fit}>
      <div
        className="fit-sizer"
        style={size ? { width: Math.ceil(size.w * size.s), height: Math.ceil(size.h * size.s) } : undefined}
        data-scale={size ? String(size.s) : undefined}
      >
        <div ref={inner} className="fit-inner" style={size ? { transform: `scale(${size.s})` } : undefined}>
          <SrDiagram {...props} />
        </div>
      </div>
    </div>
  )
}

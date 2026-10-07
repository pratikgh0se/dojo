import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Measures the px-per-user-unit scale a browser is applying to an SVG whose
 * intrinsic (viewBox) width is `viewBoxWidth`, via ResizeObserver on the
 * element `ref` is attached to. Chart components divide their label
 * geometry by this scale and draw text unscaled (see labelScale.ts), so the text
 * has the exact CSS pixel size (computed font-size == rendered size, ux spec
 * section 1: never below 14 px) regardless of how wide the panel stretches the chart.
 *
 * Falls back to a scale of 1 — no compensation — when there is no layout yet
 * (first render), the element isn't mounted, or ResizeObserver doesn't exist
 * (jsdom in unit tests): labelFontSize(1, px) just returns px, so charts
 * render sensibly there too.
 */
export function useChartScale(viewBoxWidth: number): { ref: (el: SVGSVGElement | null) => void; scale: number } {
  const elRef = useRef<SVGSVGElement | null>(null)
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const el = elRef.current
    if (!el || viewBoxWidth <= 0 || typeof ResizeObserver === 'undefined') return
    const measure = (widthPx: number) => {
      if (widthPx > 0) setScale(widthPx / viewBoxWidth)
    }
    measure(el.getBoundingClientRect().width)
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w !== undefined) measure(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewBoxWidth])

  const ref = useCallback((el: SVGSVGElement | null) => {
    elRef.current = el
  }, [])
  return { ref, scale }
}

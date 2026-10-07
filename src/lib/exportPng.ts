import { cssVar } from './cssVar'

const MIN_W = 240
const MIN_H = 120

function svgSize(svg: SVGSVGElement | null): [number, number] {
  const vb = svg?.viewBox?.baseVal
  return [Math.max(MIN_W, Math.round(vb?.width || 0)), Math.max(MIN_H, Math.round(vb?.height || 0))]
}

function loadSvg(svg: SVGSVGElement, w: number, h: number): Promise<HTMLImageElement | null> {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  const src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(src); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(src); resolve(null) }
    img.src = src
  })
}

/** Draws an <sr-diagram>'s shadow SVG on the chart well colour and starts a browser download. Nothing leaves the origin. */
export async function exportDiagramPng(host: Element | null, filename: string): Promise<boolean> {
  try {
    const svg = (host as HTMLElement | null)?.shadowRoot?.querySelector('svg') ?? null
    const [w, h] = svgSize(svg)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    ctx.fillStyle = cssVar('--sr-chart-well') || 'black'
    ctx.fillRect(0, 0, w, h)
    const img = svg ? await loadSvg(svg, w, h) : null
    if (img) ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return false
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch {
    return false
  }
}

// Snapshot (VISUALIZER "Snapshot"; labs contract §4.7, D-11): the current frame as a PNG with the caption
// baked in below it. Browser download only. No network: the frame goes through a same-origin blob: URL and
// draws in the fonts the page already has (no font fetch, so nothing leaves the app origin).
import { kebab } from '../content/atlas'

const NS = 'http://www.w3.org/2000/svg'

/** `dojo-<walkthrough-key-in-kebab>-step-<k>-of-<n>.png` (D-11). */
export function snapshotFileName(key: string, k: number, n: number): string {
  return `dojo-${kebab(key).replace(/[^a-z0-9-]+/g, '-')}-step-${k}-of-${n}.png`
}

/** Greedy word wrap at `maxChars` per line; a word longer than a line gets a line of its own. */
export function wrapCaption(text: string, maxChars: number): string[] {
  const lines: string[] = []
  let cur = ''
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (cur && (cur + ' ' + w).length > maxChars) {
      lines.push(cur)
      cur = w
    } else cur = cur ? `${cur} ${w}` : w
  }
  if (cur) lines.push(cur)
  return lines
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('snapshot: the frame did not render'))
    img.src = src
  })
}

export interface FrameText { title: string; caption: string; counter: string }

/** The engine's current drawing (open shadow root `.stage svg`) + title, caption and counter, as a PNG at 2×. */
export async function framePng(host: HTMLElement, text: FrameText): Promise<Blob> {
  const svg = host.shadowRoot?.querySelector('.stage svg')
  if (!svg) throw new Error('snapshot: nothing to capture yet')
  const [, , w, h] = (svg.getAttribute('viewBox') ?? '0 0 400 200').split(/\s+/).map(Number)
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', NS)
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.removeAttribute('style')
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
  try {
    const img = await loadImage(url)
    const style = getComputedStyle(host)
    const bg = getComputedStyle(host.shadowRoot?.querySelector('.wrap') ?? host).backgroundColor || style.backgroundColor
    const ink = style.color
    const lines = wrapCaption(text.caption, Math.max(24, Math.floor(w / 7)))
    const pad = 16
    const W = Math.max(w + pad * 2, 320)
    const H = pad + 20 + h + 12 + lines.length * 18 + 10 + 14 + pad
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = W * scale
    canvas.height = H * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('snapshot: no 2D canvas')
    ctx.scale(scale, scale)
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = ink
    ctx.font = '700 11px Silkscreen, monospace'
    ctx.fillText(text.title.toUpperCase(), pad, pad + 11)
    ctx.drawImage(img, pad, pad + 20, w, h)
    ctx.font = '13px Chivo, system-ui, sans-serif'
    lines.forEach((l, i) => ctx.fillText(l, pad, pad + 20 + h + 12 + 13 + i * 18))
    ctx.font = '10px "Space Mono", monospace'
    ctx.fillText(`${text.counter} · Dojo Atlas`, pad, H - pad)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('snapshot: encoding failed'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

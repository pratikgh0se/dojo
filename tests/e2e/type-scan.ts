import type { Page } from '@playwright/test'

/** `size` is the rendered size: the computed font-size, times the screen scale for SVG text (getScreenCTM().a). */
export interface Own { tag: string; text: string; size: number; family: string; lh: number; cls: string; shadow: boolean }

export async function ownTextElements(page: Page): Promise<Own[]> {
  return page.evaluate(() => {
    const out: Own[] = []
    const walk = (root: ParentNode, shadow: boolean) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) walk(el.shadowRoot, true)
        if (!(el instanceof HTMLElement || el instanceof SVGElement)) continue
        const own = [...el.childNodes].some(n => n.nodeType === 3 && (n.textContent ?? '').trim() !== '')
        if (own) {
          const cs = getComputedStyle(el)
          const r = el.getBoundingClientRect()
          const visible = cs.visibility !== 'hidden' && cs.display !== 'none' && (r.width > 0 || r.height > 0) && !el.closest('.vh')
          if (visible) {
            let size = parseFloat(cs.fontSize)
            if (el instanceof SVGGraphicsElement) size *= el.getScreenCTM()?.a ?? 1
            out.push({
              tag: el.tagName.toLowerCase(), text: (el.textContent ?? '').trim().slice(0, 40), size: Math.round(size * 100) / 100,
              family: cs.fontFamily, lh: cs.lineHeight === 'normal' ? 1.2 * parseFloat(cs.fontSize) : parseFloat(cs.lineHeight),
              cls: `${el.className && typeof el.className === 'string' ? el.className : ''}`, shadow,
            })
          }
        }
      }
    }
    walk(document, false)
    return out
  })
}

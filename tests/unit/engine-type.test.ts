import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adoptReadable, ENGINE_TYPE_CSS } from '../../src/lib/engineType'

class FakeSheet { text = ''; replaceSync(t: string) { this.text = t } }

beforeEach(() => {
  vi.stubGlobal('CSSStyleSheet', FakeSheet)
  Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', { configurable: true, writable: true, value: [] })
})
afterEach(() => vi.unstubAllGlobals())

const host = () => {
  const el = document.createElement('div')
  el.attachShadow({ mode: 'open' })
  ;(el.shadowRoot as unknown as { adoptedStyleSheets: unknown[] }).adoptedStyleSheets = []
  return el
}

describe('engine text sheet', () => {
  it('lifts every engine text class and SVG text to 14 px and keeps Silkscreen out', () => {
    for (const sel of ['svg text', '.code', '.vars', '.vars b', '.say', '.count', '.badge', '.title', '.bar button', 'select']) {
      expect(ENGINE_TYPE_CSS, sel).toContain(sel)
    }
    for (const m of ENGINE_TYPE_CSS.matchAll(/font-size:(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(14)
    expect(ENGINE_TYPE_CSS).not.toMatch(/Silkscreen/)
    expect(ENGINE_TYPE_CSS).toMatch(/\.vars b\{[^}]*Chivo/)
  })

  it('appends to a root that already has sheets, and never twice', () => {
    const el = host()
    const root = el.shadowRoot as unknown as { adoptedStyleSheets: unknown[] }
    root.adoptedStyleSheets = [new FakeSheet()]
    expect(adoptReadable(el)).toBe(true)
    expect(root.adoptedStyleSheets).toHaveLength(2)
    expect(adoptReadable(el)).toBe(true)
    expect(root.adoptedStyleSheets).toHaveLength(2)
    expect((root.adoptedStyleSheets[1] as FakeSheet).text).toBe(ENGINE_TYPE_CSS)
  })

  it('does nothing without a shadow root or without constructable sheets', () => {
    expect(adoptReadable(document.createElement('div'))).toBe(false)
    vi.stubGlobal('CSSStyleSheet', undefined)
    expect(adoptReadable(host())).toBe(false)
  })
})

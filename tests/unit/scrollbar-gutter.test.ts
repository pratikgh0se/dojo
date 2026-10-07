import { afterEach, describe, expect, it } from 'vitest'
import { classicScrollbars, installScrollbarGutter } from '../../src/lib/scrollbarGutter'

// UAT J2: the gutter is reserved only where scrollbars take space.
describe('scrollbar gutter', () => {
  const proto = HTMLElement.prototype
  const restore: (() => void)[] = []
  const stub = (name: 'offsetWidth' | 'clientWidth', v: number) => {
    const d = Object.getOwnPropertyDescriptor(proto, name)
    Object.defineProperty(proto, name, { configurable: true, get: () => v })
    restore.push(() => (d ? Object.defineProperty(proto, name, d) : delete (proto as unknown as Record<string, unknown>)[name]))
  }
  afterEach(() => {
    restore.splice(0).reverse().forEach(f => f())
    document.documentElement.classList.remove('classic-scrollbars')
  })

  it('overlay (or hidden) scrollbars: no class, the layout is untouched', () => {
    expect(classicScrollbars()).toBe(false)
    installScrollbarGutter()()
    expect(document.documentElement.classList.contains('classic-scrollbars')).toBe(false)
  })
  it('classic scrollbars: <html> is marked so app.css reserves the gutter', () => {
    stub('offsetWidth', 100)
    stub('clientWidth', 85)
    expect(classicScrollbars()).toBe(true)
    installScrollbarGutter()()
    expect(document.documentElement.classList.contains('classic-scrollbars')).toBe(true)
    expect(document.body.children.length).toBe(0) // the probe is gone
  })
})

// UAT cu-5 P3-5: Back returns a screen to where it was scrolled, even when the screen fills in after it mounts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { restoreScroll } from '../../src/lib/restoreScroll'

/** A window whose page is `max` px tall to scroll: scrollTo stops at the end of it, as a browser does. */
function page(initialMax: number) {
  let y = 0
  const listeners = new Map<string, Set<() => void>>()
  const win = {
    max: initialMax,
    scrollTo: vi.fn((_x: number, to: number) => { y = Math.max(0, Math.min(to, win.max)) }),
    get scrollY() { return y },
    addEventListener: (e: string, f: () => void) => { (listeners.get(e) ?? listeners.set(e, new Set()).get(e)!).add(f) },
    removeEventListener: (e: string, f: () => void) => { listeners.get(e)?.delete(f) },
    fire: (e: string) => listeners.get(e)?.forEach(f => f()),
    listening: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  }
  return win
}
const frames = (n: number) => { for (let i = 0; i < n; i++) vi.advanceTimersByTime(16) }

describe('restoreScroll', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] }))
  afterEach(() => vi.useRealTimers())

  it('scrolls at once when the page is long enough, and stops asking', () => {
    const w = page(5000)
    restoreScroll(2000, w as unknown as Window)
    frames(1)
    expect(w.scrollY).toBe(2000)
    frames(5)
    expect(w.scrollTo).toHaveBeenCalledTimes(1)
    expect(w.listening()).toBe(0)
  })

  it('keeps asking every frame while the page is still short, then lands on the saved place', () => {
    const w = page(300) // the bank has not drawn its topic yet
    restoreScroll(2000, w as unknown as Window)
    frames(3)
    expect(w.scrollY).toBe(300)
    w.max = 800
    frames(2)
    expect(w.scrollY).toBe(800)
    w.max = 4000 // the topic detail arrives
    frames(1)
    expect(w.scrollY).toBe(2000)
    const calls = w.scrollTo.mock.calls.length
    frames(5)
    expect(w.scrollTo.mock.calls.length).toBe(calls)
    expect(w.listening()).toBe(0)
  })

  it('gives up after maxMs when the page never gets long enough', () => {
    const w = page(100)
    restoreScroll(2000, w as unknown as Window, 200)
    frames(30)
    const calls = w.scrollTo.mock.calls.length
    expect(calls).toBeLessThan(30)
    frames(10)
    expect(w.scrollTo.mock.calls.length).toBe(calls)
    expect(w.listening()).toBe(0)
  })

  it('leaves the page alone the moment the learner scrolls, types or clicks', () => {
    for (const ev of ['wheel', 'touchstart', 'keydown', 'mousedown']) {
      const w = page(100)
      restoreScroll(2000, w as unknown as Window)
      frames(2)
      const calls = w.scrollTo.mock.calls.length
      w.fire(ev)
      w.max = 5000
      frames(5)
      expect(w.scrollTo.mock.calls.length, ev).toBe(calls)
    }
  })

  it('the returned function stops it (the next screen is on its way)', () => {
    const w = page(100)
    const stop = restoreScroll(2000, w as unknown as Window)
    frames(2)
    stop()
    const calls = w.scrollTo.mock.calls.length
    w.max = 5000
    frames(5)
    expect(w.scrollTo.mock.calls.length).toBe(calls)
    expect(w.listening()).toBe(0)
  })
})

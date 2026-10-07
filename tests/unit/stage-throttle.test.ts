import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDLE_MS, throttleStage } from '../../src/ui/engines/stageThrottle'

// perf diagnostic P2: the avatar's render loop sleeps when hidden, idle or with reduced motion, and wakes on input.
class FakeStage extends HTMLElement {
  draws = 0
  _alive = true
  _raf = 0
  _tick() { this._raf = requestAnimationFrame(() => (this as unknown as { _tick: () => void })._tick()); this.draws++ }
}
customElements.define('fake-stage', FakeStage)

describe('throttleStage', () => {
  afterEach(() => { vi.useRealTimers() })
  it('draws once then sleeps with reduced motion; wakes for one frame on an attribute change', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance', 'setTimeout'] })
    const el = document.createElement('fake-stage') as FakeStage
    document.body.appendChild(el)
    const undo = throttleStage(el as never, () => true)
    ;(el as unknown as { _tick: () => void })._tick()
    vi.advanceTimersByTime(1000)
    expect(el.draws).toBe(1)
    el.setAttribute('pose', 'powerup')
    await Promise.resolve()
    vi.advanceTimersByTime(1000)
    expect(el.draws).toBe(2)
    undo()
  })
  it('draws one frame after a window resize (zoom), even asleep (UAT cu-r3b P3-2)', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance', 'setTimeout'] })
    const el = document.createElement('fake-stage') as FakeStage
    document.body.appendChild(el)
    const undo = throttleStage(el as never, () => true)
    ;(el as unknown as { _tick: () => void })._tick()
    vi.advanceTimersByTime(1000)
    expect(el.draws).toBe(1)
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(1000)
    expect(el.draws).toBe(2)
    undo()
    window.dispatchEvent(new Event('resize'))
    vi.advanceTimersByTime(1000)
    expect(el.draws).toBe(2)
  })
  it('caps at 30 fps while active, and sleeps after IDLE_MS without input until the next input', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'performance', 'setTimeout'] })
    const el = document.createElement('fake-stage') as FakeStage
    document.body.appendChild(el)
    const undo = throttleStage(el as never, () => false)
    ;(el as unknown as { _tick: () => void })._tick()
    vi.advanceTimersByTime(1000)
    expect(el.draws).toBeGreaterThan(20)
    expect(el.draws).toBeLessThanOrEqual(32)
    vi.advanceTimersByTime(IDLE_MS + 1000)
    const asleep = el.draws
    vi.advanceTimersByTime(2000)
    expect(el.draws).toBe(asleep)
    window.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(1000)
    expect(el.draws).toBeGreaterThan(asleep + 20)
    undo()
  })
})

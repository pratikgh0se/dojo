// Leftover 4: a clock with no running timer re-renders once a minute, not once a second. The cheap one-second clock CHECK of
// fix13 stays (a jump is followed within a second), but it sets no state unless the clock jumped or the period passed.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetNow, setNow } from '../../src/lib/clock'
import { IDLE_TICK_MS, useNow, useSecondsNow } from '../../src/lib/useNow'

const T0 = new Date(2026, 9, 14, 12, 0, 0).getTime()
let clock = T0
beforeEach(() => { vi.useFakeTimers(); clock = T0; setNow(() => clock) })
afterEach(() => { vi.useRealTimers(); resetNow() })

/** Renders `hook` for `seconds` simulated seconds and returns how many times it rendered. */
function renders<T>(hook: () => T, seconds: number): number {
  let n = 0
  renderHook(() => { n++; return hook() })
  for (let s = 1; s <= seconds; s++) { clock = T0 + s * 1000; act(() => { vi.advanceTimersByTime(1000) }) }
  return n
}

describe('useSecondsNow without an anchor', () => {
  it('idles at one render a minute when asked to', () => {
    expect(IDLE_TICK_MS).toBe(60_000)
    expect(renders(() => useSecondsNow(undefined, IDLE_TICK_MS), 59)).toBeLessThanOrEqual(2)
  })
  it('still follows a clock set three weeks ahead within a second', () => {
    const { result } = renderHook(() => useSecondsNow(null, IDLE_TICK_MS))
    clock = T0 + 21 * 86_400_000
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current).toBe(clock)
  })
  it('keeps the old one-second reading when no idle period is given', () => {
    expect(renders(() => useSecondsNow(undefined), 5)).toBeGreaterThanOrEqual(6)
  })
})

describe('useSecondsNow with an anchor', () => {
  it('ticks on the anchor\'s own seconds whatever the idle period is', () => {
    const { result } = renderHook(() => useSecondsNow(T0 - 400, IDLE_TICK_MS))
    clock = T0 + 600
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current).toBe(T0 + 600)
  })
})

describe('useNow', () => {
  it('a 60 s period renders about once a minute', () => {
    expect(renders(() => useNow(60_000), 59)).toBeLessThanOrEqual(2)
  })
})

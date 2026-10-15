// BANK-15: a tester fixes the browser clock after the page has loaded; Review and the badge must follow within a second or two,
// not at the next 60 s tick. useNow re-reads the clock every second and moves on when it jumped (either way) or its period passed.
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetNow, setNow } from '../../src/lib/clock'
import { useNow } from '../../src/lib/useNow'

const T0 = new Date(2026, 9, 14, 12, 0, 0).getTime()
let clock = T0

beforeEach(() => {
  vi.useFakeTimers()
  clock = T0
  setNow(() => clock)
})
afterEach(() => {
  vi.useRealTimers()
  resetNow()
})

describe('useNow with a long period', () => {
  it('keeps its cadence: no new value until the period has passed', () => {
    const { result } = renderHook(() => useNow(60_000))
    expect(result.current).toBe(T0)
    clock = T0 + 30_000
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(result.current).toBe(T0)
    clock = T0 + 60_000
    act(() => { vi.advanceTimersByTime(30_000) })
    expect(result.current).toBe(T0 + 60_000)
  })
  it('follows a clock set three weeks ahead within a second', () => {
    const { result } = renderHook(() => useNow(60_000))
    clock = T0 + 21 * 86_400_000
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current).toBe(clock)
  })
  it('follows a clock set back within a second', () => {
    const { result } = renderHook(() => useNow(60_000))
    clock = T0 - 5_000
    act(() => { vi.advanceTimersByTime(1000) })
    expect(result.current).toBe(T0 - 5_000)
  })
})

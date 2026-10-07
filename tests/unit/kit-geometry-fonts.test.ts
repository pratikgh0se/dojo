import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useFontsReadyVersion } from '../../src/screens/designSession/kit/geometry'

const original = (document as unknown as { fonts?: unknown }).fonts

afterEach(() => {
  Object.defineProperty(document, 'fonts', { value: original, configurable: true })
})

describe('useFontsReadyVersion (kit overlay re-layout on web font load)', () => {
  it('stays 0 when document.fonts is unavailable (jsdom default)', () => {
    Object.defineProperty(document, 'fonts', { value: undefined, configurable: true })
    const { result } = renderHook(() => useFontsReadyVersion())
    expect(result.current).toBe(0)
  })

  it('bumps once document.fonts.ready resolves, so a memo keyed on it recomputes', async () => {
    let resolveReady: () => void = () => {}
    const ready = new Promise<void>(resolve => { resolveReady = resolve })
    Object.defineProperty(document, 'fonts', { value: { ready }, configurable: true })
    const { result } = renderHook(() => useFontsReadyVersion())
    expect(result.current).toBe(0)
    await act(async () => {
      resolveReady()
      await ready
    })
    expect(result.current).toBe(1)
  })
})

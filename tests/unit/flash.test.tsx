import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, FlashProvider, useFlash } from '../../src/ui/primitives'

function FlashButton() {
  const flash = useFlash()
  return <Button onClick={flash}>Flash</Button>
}

afterEach(() => {
  vi.useRealTimers()
  delete document.documentElement.dataset.flashes
})

describe('Flash timeout', () => {
  it('keeps a 120 ms timer pending while mounted, then clears the flash', () => {
    vi.useFakeTimers()
    render(<FlashProvider><FlashButton /></FlashProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Flash' }))
    expect(screen.getByTestId('flash')).toBeInTheDocument()
    expect(vi.getTimerCount()).toBe(1)
    act(() => { vi.advanceTimersByTime(119) })
    expect(screen.getByTestId('flash')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.queryByTestId('flash')).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the pending timer on unmount so nothing fires after teardown', () => {
    vi.useFakeTimers()
    const { unmount } = render(<FlashProvider><FlashButton /></FlashProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Flash' }))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    expect(() => vi.advanceTimersByTime(500)).not.toThrow()
  })

  it('cancels every pending timer when fired twice before unmount', () => {
    vi.useFakeTimers()
    const { unmount } = render(<FlashProvider><FlashButton /></FlashProvider>)
    const btn = screen.getByRole('button', { name: 'Flash' })
    fireEvent.click(btn)
    act(() => { vi.advanceTimersByTime(50) })
    fireEvent.click(btn)
    expect(vi.getTimerCount()).toBe(2)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

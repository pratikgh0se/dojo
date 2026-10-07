import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { TIP_DELAY_MS, TipHost, tipProps } from '../../src/ui/Tip'

// UAT cu-3 P2-1 / P3-4: a control with `data-tip` shows its words in a bubble of the page's own, under it, on a real hover
// (the operating system's `title` tooltip did not appear in the desktop app) and at once on keyboard focus.
function Page() {
  return (
    <>
      <button type="button" data-testid="a" {...tipProps('Undo: move X to Sprint 2')}>Undo (1)</button>
      <button type="button" data-testid="b">Plain</button>
      <TipHost />
    </>
  )
}

afterEach(() => { document.body.innerHTML = '' })

describe('ui/Tip', () => {
  it('tipProps carries the bubble text and the accessible description, and NO native title (cu-final: two boxes)', () => {
    expect(tipProps('Hello')).toEqual({ 'data-tip': 'Hello', 'aria-description': 'Hello' })
    expect(tipProps('Hello')).not.toHaveProperty('title')
    expect(tipProps('Hello', 'right')).toMatchObject({ 'data-tip-side': 'right' })
  })

  it('a control with a tip has exactly one tooltip: the bubble, and no title attribute', async () => {
    render(<Page />)
    const a = screen.getByTestId('a')
    expect(a).not.toHaveAttribute('title')
    fireEvent.pointerOver(a)
    expect(await screen.findByTestId('tip', {}, { timeout: TIP_DELAY_MS + 1500 })).toHaveTextContent('Undo: move X to Sprint 2')
    expect(a).not.toHaveAttribute('title')
    fireEvent.pointerOver(screen.getByTestId('b'))
    await waitFor(() => expect(screen.queryByTestId('tip')).toBeNull())
  })

  it('shows after the pointer has rested on the element and goes when it leaves', async () => {
    render(<Page />)
    expect(screen.queryByTestId('tip')).toBeNull()
    fireEvent.pointerOver(screen.getByTestId('a'))
    expect(screen.queryByTestId('tip')).toBeNull() // not at once: a hover that passes by shows nothing
    const tip = await screen.findByTestId('tip', {}, { timeout: TIP_DELAY_MS + 1500 })
    expect(tip).toHaveTextContent('Undo: move X to Sprint 2')
    expect(tip).toHaveAttribute('aria-hidden', 'true')
    fireEvent.pointerOver(screen.getByTestId('b'))
    await waitFor(() => expect(screen.queryByTestId('tip')).toBeNull())
  })

  it('a pointer that leaves before the delay shows nothing', async () => {
    render(<Page />)
    fireEvent.pointerOver(screen.getByTestId('a'))
    fireEvent.pointerOver(screen.getByTestId('b'))
    await act(async () => { await new Promise(r => setTimeout(r, TIP_DELAY_MS + 100)) })
    expect(screen.queryByTestId('tip')).toBeNull()
  })

  it('shows at once on keyboard focus and goes on blur, a key press or a press', async () => {
    render(<Page />)
    const a = screen.getByTestId('a')
    act(() => a.focus())
    expect(await screen.findByTestId('tip')).toHaveTextContent('Undo: move X to Sprint 2')
    act(() => screen.getByTestId('b').focus())
    await waitFor(() => expect(screen.queryByTestId('tip')).toBeNull())
    act(() => a.focus())
    await screen.findByTestId('tip')
    fireEvent.keyDown(a, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('tip')).toBeNull())
    act(() => a.blur())
    act(() => a.focus())
    await screen.findByTestId('tip')
    fireEvent.pointerDown(a)
    await waitFor(() => expect(screen.queryByTestId('tip')).toBeNull())
  })

  it('a tipped control that appears under a resting pointer (no pointerover) still shows its tip (cu-r1 A21/A43)', async () => {
    function Late() {
      const [on, setOn] = useState(false)
      return (<><button type="button" data-testid="b" onClick={() => setOn(true)}>Plain</button>{on && <button type="button" data-testid="late" {...tipProps('Stop the timer')}>Retreat</button>}<TipHost /></>)
    }
    const { unmount } = render(<Late />)
    const b = screen.getByTestId('b')
    fireEvent.pointerOver(b, { clientX: 5, clientY: 5 })
    document.elementFromPoint = () => document.querySelector('[data-testid="late"]')
    fireEvent.click(b)
    expect(await screen.findByTestId('tip', {}, { timeout: TIP_DELAY_MS + 1500 })).toHaveTextContent('Stop the timer')
    unmount()
  })
})

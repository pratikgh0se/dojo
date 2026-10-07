import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { safeWrite } from '../../src/data/safeWrite'
import { isPlainClick, NAVIGATE_WRITE_TIMEOUT_MS, useNavigateAfterWrites } from '../../src/data/useNavigateAfterWrites'

function Probe() {
  return <div data-testid="where">{useLocation().pathname}</div>
}
function Go() {
  const go = useNavigateAfterWrites()
  return <button onClick={() => go('/atlas')}>go</button>
}

describe('useNavigateAfterWrites', () => {
  it('navigates only after the pending safeWrite settles', async () => {
    let release!: () => void
    render(<MemoryRouter initialEntries={['/dsa']}><Routes><Route path="*" element={<><Go /><Probe /></>} /></Routes></MemoryRouter>)
    void safeWrite(() => new Promise<void>(r => { release = r }), () => {})
    await act(async () => { screen.getByText('go').click() })
    expect(screen.getByTestId('where')).toHaveTextContent('/dsa')
    await act(async () => { release() })
    expect(screen.getByTestId('where')).toHaveTextContent('/atlas')
  })
  it('I1: navigates anyway once the timeout cap elapses when a write never settles', async () => {
    vi.useFakeTimers()
    try {
      render(<MemoryRouter initialEntries={['/dsa']}><Routes><Route path="*" element={<><Go /><Probe /></>} /></Routes></MemoryRouter>)
      void safeWrite(() => new Promise<void>(() => {}), () => {}) // never resolves
      await act(async () => { screen.getByText('go').click() })
      expect(screen.getByTestId('where')).toHaveTextContent('/dsa')
      await act(async () => { await vi.advanceTimersByTimeAsync(NAVIGATE_WRITE_TIMEOUT_MS) })
      expect(screen.getByTestId('where')).toHaveTextContent('/atlas')
    } finally {
      vi.useRealTimers()
    }
  })
  it('isPlainClick: left button, no modifiers, not prevented', () => {
    const base = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false }
    expect(isPlainClick(base)).toBe(true)
    expect(isPlainClick({ ...base, metaKey: true })).toBe(false)
    expect(isPlainClick({ ...base, button: 1 })).toBe(false)
    expect(isPlainClick({ ...base, defaultPrevented: true })).toBe(false)
  })
})

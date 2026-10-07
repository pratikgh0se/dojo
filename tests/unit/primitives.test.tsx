import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Button,
  FlashProvider,
  Meter,
  POWERUP_MS,
  PowerUpProvider,
  ToastProvider,
  TOAST_MS,
  useFlash,
  usePowerUp,
  useToast,
} from '../../src/ui/primitives'

function ToastButton() {
  const toast = useToast()
  return <Button onClick={() => toast('+10 xp')}>Go</Button>
}
function FlashButton() {
  const flash = useFlash()
  return <Button onClick={flash}>Flash</Button>
}

afterEach(() => {
  vi.useRealTimers()
  delete (window as { matchMedia?: unknown }).matchMedia
  delete document.documentElement.dataset.flashes
})

describe('primitives', () => {
  it('Button defaults to type=button and applies the variant class', () => {
    render(<Button variant="accent">Start</Button>)
    const b = screen.getByRole('button', { name: 'Start' })
    expect(b).toHaveAttribute('type', 'button')
    expect(b).toHaveClass('sr-btn', 'sr-btn-accent')
  })

  it('Toast shows text in a status region and expires', () => {
    vi.useFakeTimers()
    render(<ToastProvider><ToastButton /></ToastProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(screen.getByRole('status')).toHaveTextContent('+10 xp')
    act(() => { vi.advanceTimersByTime(TOAST_MS) })
    expect(screen.queryByTestId('toast')).toBeNull()
  })

  it('Flash shows briefly and counts on <html>', () => {
    vi.useFakeTimers()
    render(<FlashProvider><FlashButton /></FlashProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Flash' }))
    expect(screen.getByTestId('flash')).toBeInTheDocument()
    expect(document.documentElement.dataset.flashes).toBe('1')
    act(() => { vi.advanceTimersByTime(120) })
    expect(screen.queryByTestId('flash')).toBeNull()
  })

  it('Flash is skipped under prefers-reduced-motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
    render(<FlashProvider><FlashButton /></FlashProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Flash' }))
    expect(screen.queryByTestId('flash')).toBeNull()
    expect(document.documentElement.dataset.flashes).toBeUndefined()
  })

  it('Meter renders N cubes with the first `on` lit', () => {
    const { container } = render(<Meter segments={12} on={5} label="to KINDLE" />)
    const cubes = container.querySelectorAll('.sr-cube')
    expect(cubes).toHaveLength(12)
    expect(container.querySelectorAll('.sr-cube[data-on="true"]')).toHaveLength(5)
  })

  it('Meter stretch drops the fixed cube size so cubes fill the row', () => {
    const { container } = render(<Meter segments={12} on={3} label="to KINDLE" stretch />)
    expect(container.querySelector('.sr-meter')).toHaveClass('stretch')
    expect((container.querySelector('.sr-cube') as HTMLElement).style.width).toBe('')
  })
})

describe('PowerUp (README-dashboard: Pom powerup for 1.8 s after a tick)', () => {
  function Probe() {
    const p = usePowerUp()
    return <button onClick={() => p.fire()}>{p.active ? 'on' : 'off'}</button>
  }
  it('is active for POWERUP_MS after fire, and counts fires on <html>', () => {
    vi.useFakeTimers()
    delete document.documentElement.dataset.powerups
    render(<PowerUpProvider><Probe /></PowerUpProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'off' }))
    expect(screen.getByRole('button', { name: 'on' })).toBeInTheDocument()
    expect(document.documentElement.dataset.powerups).toBe('1')
    act(() => { vi.advanceTimersByTime(POWERUP_MS - 1) })
    expect(screen.getByRole('button', { name: 'on' })).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByRole('button', { name: 'off' })).toBeInTheDocument()
    vi.useRealTimers()
  })
  it('toast is gone after 1.4 s and powerup ends after 1.8 s, in the same tick reward (README-dashboard "Ticking anything")', () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <PowerUpProvider>
          <ToastButton />
          <Probe />
        </PowerUpProvider>
      </ToastProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    fireEvent.click(screen.getByRole('button', { name: 'off' }))
    expect(screen.getByTestId('toast')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'on' })).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(TOAST_MS) })
    expect(screen.queryByTestId('toast')).toBeNull()
    expect(screen.getByRole('button', { name: 'on' })).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(POWERUP_MS - TOAST_MS) })
    expect(screen.getByRole('button', { name: 'off' })).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('is skipped under prefers-reduced-motion, so Pom stays out of the powerup pose', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
    delete document.documentElement.dataset.powerups
    render(<PowerUpProvider><Probe /></PowerUpProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'off' }))
    expect(screen.getByRole('button', { name: 'off' })).toBeInTheDocument()
    expect(document.documentElement.dataset.powerups).toBeUndefined()
  })
})

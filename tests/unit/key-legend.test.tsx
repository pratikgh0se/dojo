import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { Shell } from '../../src/app/Shell'
import type { DojoDB } from '../../src/data/db'
import { setNow } from '../../src/lib/clock'
import { TIMER_KEY } from '../../src/lib/timer'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'

// Ruling 23 K1 (UAT cu-1 P2-3): every key the footer legend shows acts on that screen; a key that means nothing there is
// left out; space never scrolls Today while the legend says "space timer".
const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const GLOBAL = '1–9, 0 tabs · a atlas · b banks · m more · t today'

function Where() { return <div data-testid="where">{useLocation().pathname}</div> }

async function renderShell(route: string, when = '2026-09-07T21:10:00'): Promise<DojoDB> {
  setNow(() => ist(when)) // Monday of sprint 1: Today's NOW item is m1w1t1
  const d = await seededDb()
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[route]}>
      <AppProviders db={d} plan={smallPlan}>
        <Shell />
        <Where />
      </AppProviders>
    </MemoryRouter>,
  )
  await screen.findByTestId('more-button')
  await act(async () => { await new Promise(r => setTimeout(r, 50)) }) // the screens' passive effects (key listeners) have run
  return d
}
const legend = () => screen.getByTestId('keys-legend').textContent
const stored = () => JSON.parse(localStorage.getItem(TIMER_KEY) ?? 'null')
/** fireEvent returns false when the key's default (the page scroll) was prevented */
const press = (target: Element | Window, init: KeyboardEventInit) => fireEvent.keyDown(target, init)

afterEach(() => { localStorage.clear() })

describe('footer legend, per screen', () => {
  it('Today with a NOW item lists Enter, space, d and s', async () => {
    await renderShell('/')
    await screen.findByTestId('start-button')
    await waitFor(() => expect(legend()).toBe(`${GLOBAL} · Enter start · space timer · d done · s slide`))
  })

  it('Today on a rest day (no NOW item) lists none of them', async () => {
    await renderShell('/', '2026-09-11T10:00:00') // Friday: off
    await screen.findByTestId('now-headline')
    expect(screen.queryByTestId('start-button')).toBeNull()
    expect(legend()).toBe(GLOBAL)
  })

  it('other screens list only the global keys, and never "Esc leave Do"', async () => {
    await renderShell('/settings')
    expect(legend()).toBe(GLOBAL)
    expect(legend()).not.toMatch(/Enter|space|Shift|Esc/)
  })

  it('leaving Today takes its keys off the legend', async () => {
    await renderShell('/')
    await waitFor(() => expect(legend()).toContain('space timer'))
    press(document.body, { key: '3' })
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/dsa'))
    expect(legend()).toBe(GLOBAL)
  })

  it('Board: the card keys appear while a card has focus, Enter only while the card itself has it', async () => {
    await renderShell('/board')
    expect(legend()).toBe(GLOBAL)
    const card = await screen.findByTestId('card-m1w1t1')
    act(() => card.focus())
    await waitFor(() => expect(legend()).toBe(`${GLOBAL} · Enter open · Shift+←/→ move · d done · s slide`))
    const slideBtn = card.querySelector<HTMLElement>('.rail button')!
    act(() => slideBtn.focus())
    await waitFor(() => expect(legend()).toBe(`${GLOBAL} · Shift+←/→ move · d done · s slide`))
    act(() => slideBtn.blur())
    await waitFor(() => expect(legend()).toBe(GLOBAL))
  })
})

describe('Today keys', () => {
  it('space starts Spar · 25, pauses it, resumes it; the page never scrolls', async () => {
    await renderShell('/')
    await screen.findByTestId('spar-25')
    expect(press(document.body, { key: ' ' })).toBe(false) // default prevented: no scroll
    await waitFor(() => expect(stored()).toMatchObject({ ticketId: 'm1w1t1', min: 25, running: true }))
    expect(await screen.findByTestId('now-readout')).toHaveTextContent('25:00')
    expect(press(document.body, { key: ' ' })).toBe(false)
    await waitFor(() => expect(stored()).toMatchObject({ running: false, pausedRemaining: 25 * 60_000 }))
    expect(screen.getByTestId('now-readout')).toHaveAttribute('data-paused', 'true')
    expect(screen.getByTestId('now-timer-sub')).toHaveTextContent('of 25 min · paused')
    expect(screen.queryByTestId('spar-50')).toBeNull()
    expect(press(document.body, { key: ' ' })).toBe(false)
    await waitFor(() => expect(stored()).toMatchObject({ running: true }))
    expect(stored().pausedRemaining).toBeUndefined()
    expect(screen.getByTestId('now-readout')).not.toHaveAttribute('data-paused')
  })

  it('space on a link scrolls nothing (the timer takes it); on a button the button keeps it', async () => {
    await renderShell('/')
    const start = await screen.findByTestId('start-button') // a link
    expect(press(start, { key: ' ' })).toBe(false)
    await waitFor(() => expect(stored()).toMatchObject({ running: true }))
    const retreat = screen.getByRole('button', { name: 'Retreat: stop the timer' })
    expect(press(retreat, { key: ' ' })).toBe(true) // untouched: the browser clicks the button
    expect(stored()).toMatchObject({ running: true })
  })

  it('keys typed in a field, with a modifier, or held down do nothing', async () => {
    const d = await renderShell('/')
    await screen.findByTestId('spar-25')
    const field = document.body.appendChild(document.createElement('input'))
    press(field, { key: ' ' })
    press(field, { key: 'd' })
    press(document.body, { key: ' ', ctrlKey: true })
    press(document.body, { key: 'd', metaKey: true })
    press(document.body, { key: 's', repeat: true })
    press(document.body, { key: 'D' })
    expect(stored()).toBeNull()
    expect((await d.tickets.get('m1w1t1'))!.status).toBe('todo')
    expect((await d.tickets.get('m1w1t1'))!.sprint).toBe(1)
    field.remove()
  })

  it('d marks the NOW item done', async () => {
    const d = await renderShell('/')
    await screen.findByTestId('spar-25')
    press(document.body, { key: 'd' })
    await waitFor(async () => expect((await d.tickets.get('m1w1t1'))!.status).toBe('done'))
  })

  it('s slides the NOW item to the next sprint, with a toast', async () => {
    const d = await renderShell('/')
    await screen.findByTestId('spar-25')
    press(document.body, { key: 's' })
    await waitFor(async () => expect((await d.tickets.get('m1w1t1'))!.sprint).toBe(2))
    expect(await screen.findByText(/^Slid .+ to Sprint 2$/)).toBeInTheDocument()
  })

  it('Enter opens the NOW item, as before', async () => {
    await renderShell('/')
    await screen.findByTestId('start-button')
    press(document.body, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/do/m1w1t1'))
  })
})

describe('Board keys', () => {
  it('d, s and Shift+arrows act on the card that has focus, also from a control inside it', async () => {
    const d = await renderShell('/board')
    const card = await screen.findByTestId('card-m1w1t1')
    act(() => card.focus())
    press(card, { key: 'ArrowRight', shiftKey: true })
    await waitFor(async () => expect((await d.tickets.get('m1w1t1'))!.status).toBe('doing'))
    // from the Slide button inside the (re-rendered) card
    const again = await screen.findByTestId('card-m1w1t1')
    const inner = again.querySelector<HTMLElement>('.rail button')!
    act(() => inner.focus())
    press(inner, { key: 'd' })
    await waitFor(async () => expect((await d.tickets.get('m1w1t1'))!.status).toBe('done'))
  })

  it('s on a card slides it; with no card focused the keys do nothing', async () => {
    const d = await renderShell('/board')
    const card = await screen.findByTestId('card-m1w1t1')
    press(document.body, { key: 'd' })
    press(document.body, { key: 's' })
    press(document.body, { key: 'ArrowRight', shiftKey: true })
    expect((await d.tickets.get('m1w1t1'))!.status).toBe('todo')
    expect((await d.tickets.get('m1w1t1'))!.sprint).toBe(1)
    act(() => card.focus())
    press(card, { key: 's' })
    await waitFor(async () => expect((await d.tickets.get('m1w1t1'))!.sprint).toBe(2))
  })

  it('Enter on a control inside a card is that control\'s own: it does not open the card', async () => {
    await renderShell('/board')
    const card = await screen.findByTestId('card-m1w1t1')
    const inner = card.querySelector<HTMLElement>('.rail button')!
    act(() => inner.focus())
    press(inner, { key: 'Enter' })
    expect(screen.getByTestId('where').textContent).toBe('/board')
    act(() => card.focus())
    press(card, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/do/m1w1t1'))
  })
})

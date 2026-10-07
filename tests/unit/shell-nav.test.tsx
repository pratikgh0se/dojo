import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { Shell } from '../../src/app/Shell'
import { TABS } from '../../src/app/tabs'
import { setNow } from '../../src/lib/clock'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

function stubWidth(narrow: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (q: string) => ({
      matches: narrow && q.includes('max-width: 767px'),
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
}

async function renderShell(route = '/board') {
  setNow(() => ist('2026-09-08T10:00:00'))
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
}

const at = () => screen.getByTestId('where').textContent

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('Shell nav (Review Focus #1)', () => {
  it('shows exactly the five primary tabs plus More', async () => {
    await renderShell()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map(a => a.textContent)).toEqual(['Today', 'Board', 'DSA', 'Designs', 'AI'])
    expect(within(nav).getByTestId('more-button')).toBeInTheDocument()
  })

  it('m opens More, Esc closes it, number keys navigate', async () => {
    await renderShell()
    fireEvent.keyDown(document.body, { key: 'm' })
    expect(screen.getByRole('menu', { name: 'More' })).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.keyDown(document.body, { key: '6' })
    await waitFor(() => expect(at()).toBe('/map'))
    fireEvent.keyDown(document.body, { key: '0' })
    await waitFor(() => expect(at()).toBe('/settings'))
  })

  it('closes the menu when a number key navigates away', async () => {
    await renderShell()
    fireEvent.keyDown(document.body, { key: 'm' })
    fireEvent.keyDown(document.activeElement!, { key: '3' })
    await waitFor(() => expect(at()).toBe('/dsa'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('keys do nothing while typing in the Settings date input', async () => {
    await renderShell('/settings')
    const input = await screen.findByLabelText('Start date')
    fireEvent.keyDown(input, { key: '3' })
    fireEvent.keyDown(input, { key: 'm' })
    expect(at()).toBe('/settings')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('every tab control exposes its key via aria-keyshortcuts, generated from TABS (labs D-6)', async () => {
    await renderShell()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link').map(a => a.getAttribute('aria-keyshortcuts'))).toEqual(['1', '2', '3', '4', '5'])
    fireEvent.click(screen.getByTestId('more-button'))
    const byLabel = Object.fromEntries(screen.getAllByRole('menuitem').map(i => [i.getAttribute('aria-label'), i.getAttribute('aria-keyshortcuts')]))
    for (const t of TABS.filter(t => t.group === 'more')) expect(byLabel[t.label], t.label).toBe(t.key)
  })

  it('has no theme toggle anywhere (dark only)', async () => {
    await renderShell()
    expect(screen.queryByRole('button', { name: /workshop|console|theme|light|dark/i })).toBeNull()
    fireEvent.click(screen.getByTestId('more-button'))
    expect(screen.getAllByRole('menuitem')).toHaveLength(9)
    expect(screen.queryByRole('menuitem', { name: /workshop|console|theme|light|dark/i })).toBeNull()
  })

  it('phone (< 768): Designs and AI lead the More menu with their key hints (ui-shell S2)', async () => {
    stubWidth(true)
    await renderShell('/board')
    fireEvent.click(screen.getByTestId('more-button'))
    const items = screen.getAllByRole('menuitem')
    expect(items.map(i => i.getAttribute('aria-label'))).toEqual(
      ['Designs', 'AI', 'Map', 'Progress', 'Week', 'Overview', 'Atlas', 'Banks', 'Mentors', 'Ritual', 'Settings'])
    expect(items.slice(0, 2).map(i => i.getAttribute('aria-keyshortcuts'))).toEqual(['4', '5'])
    fireEvent.click(items[0])
    await waitFor(() => expect(at()).toBe('/designs'))
  })

  it('phone: on a Designs route the More button is the active tab and names it', async () => {
    stubWidth(true)
    await renderShell('/designs')
    const more = screen.getByTestId('more-button')
    expect(more.className).toContain('tab-on')
    expect(more.textContent).toContain('Designs')
  })

  it('desktop: Designs and AI are nav tabs (tab-wide, hidden by CSS on phone), not menu items', async () => {
    stubWidth(false)
    await renderShell('/designs')
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'Designs' }).className).toContain('tab-wide')
    expect(within(nav).getByRole('link', { name: 'AI' }).className).toContain('tab-wide')
    expect(within(nav).getByRole('link', { name: 'Today' }).className).not.toContain('tab-wide')
    expect(screen.getByTestId('more-button').className).not.toContain('tab-on')
  })
})

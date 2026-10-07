import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { AppRoutes } from '../../src/app/routes'
import { MORE_TABS, PRIMARY_TABS, TABS, tabForPath } from '../../src/app/tabs'
import { setNow } from '../../src/lib/clock'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

async function renderAt(route: string) {
  setNow(() => ist('2026-09-08T10:00:00'))
  const d = await seededDb()
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[route]}>
      <AppProviders db={d} plan={smallPlan}>
        <AppRoutes />
        <Where />
      </AppProviders>
    </MemoryRouter>,
  )
}

describe('tab registry', () => {
  it('has fourteen destinations: five primary, nine under More', () => {
    expect(TABS).toHaveLength(14)
    expect(PRIMARY_TABS.map(t => t.label)).toEqual(['Today', 'Board', 'DSA', 'Designs', 'AI'])
    expect(MORE_TABS.map(t => t.label)).toEqual(['Map', 'Progress', 'Week', 'Overview', 'Atlas', 'Banks', 'Mentors', 'Ritual', 'Settings'])
  })

  it('maps a pathname to its tab, with / matching only Today', () => {
    expect(tabForPath('/')?.label).toBe('Today')
    expect(tabForPath('/map')?.label).toBe('Map')
    expect(tabForPath('/do/p1')).toBeUndefined()
    expect(tabForPath('/atlas')?.label).toBe('Atlas')
    expect(tabForPath('/banks')?.label).toBe('Banks')
    expect(tabForPath('/designs/session/d-ratelimit')?.label).toBe('Designs')
  })

  it.each(TABS.map(t => [t.label, t.to] as const))('%s (%s) renders without redirecting', async (_label, to) => {
    await renderAt(to)
    expect(screen.getByTestId('where').textContent).toBe(to)
    await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull())
  })

  it('redirects an unknown path to Today', async () => {
    await renderAt('/nope')
    expect(screen.getByTestId('where').textContent).toBe('/')
  })

  it.each(TABS.map(t => [t.label, t.to] as const))('%s (%s) is a real screen, not the M5 placeholder', async (_label, to) => {
    await renderAt(to)
    expect(screen.queryByTestId('soon')).toBeNull()
  })

  it('Atlas and Banks render a real header with one purpose line', async () => {
    await renderAt('/atlas')
    expect(await screen.findByRole('heading', { level: 1, name: 'Atlas' })).toBeInTheDocument()
    expect(await screen.findByTestId('atlas-summary')).toHaveTextContent('16 atoms · 36 patterns · you have predicted 0')
  })

  it('Banks renders its header and bank switcher (chain B real screen, not the M5 stub)', async () => {
    await renderAt('/banks')
    expect(await screen.findByTestId('banks-page')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Banks' })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Banks' })).toBeInTheDocument()
  })

  it.each([
    ['/designs/session/d-ratelimit'],
    ['/designs/session/d%20nope'],
  ])('the design session route renders "Design not found" for an id absent from the small plan (%s), without redirecting', async route => {
    await renderAt(route)
    expect(screen.getByTestId('where').textContent).toBe(route)
    expect(await screen.findByRole('heading', { level: 1, name: 'Design not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Designs' })).toHaveAttribute('href', '/designs')
  })
})

describe('screen roots (contract UX addendum 1, Q1)', () => {
  it.each([
    ['today', '/'], ['board', '/board'], ['dsa', '/dsa'], ['designs', '/designs'], ['ai', '/ai'],
    ['banks', '/banks'], ['progress', '/progress'], ['settings', '/settings'],
  ])('%s carries screen-%s and turns data-ready true once loaded', async (name, path) => {
    await renderAt(path)
    const root = screen.getByTestId(`screen-${name}`)
    await waitFor(() => expect(root).toHaveAttribute('data-ready', 'true'), { timeout: 4000 })
    expect(root.querySelector('.loading')).toBeNull()
  })
  it('do carries screen-do next to its own do-screen', async () => {
    await renderAt('/do/m1w1t1')
    const root = screen.getByTestId('screen-do')
    await waitFor(() => expect(root).toHaveAttribute('data-ready', 'true'), { timeout: 4000 })
    expect(root.querySelector('[data-testid="do-screen"]')).not.toBeNull()
  })
})

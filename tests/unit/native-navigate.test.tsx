import { act, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { Shell } from '../../src/app/Shell'
import { setNow } from '../../src/lib/clock'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'

// Ruling 23 K4: Dojo › Settings… (⌘,) in the native menu has the main process dispatch `dojo:navigate` in the page.
function Where() { return <div data-testid="where">{useLocation().pathname}</div> }

async function renderShell(route: string) {
  setNow(() => new Date('2026-09-08T10:00:00+05:30').getTime())
  render(
    <MemoryRouter initialEntries={[route]}>
      <AppProviders db={await seededDb()} plan={smallPlan}>
        <Shell />
        <Where />
      </AppProviders>
    </MemoryRouter>,
  )
  await screen.findByTestId('where')
}
const dispatch = (detail: unknown) => act(() => { window.dispatchEvent(new CustomEvent('dojo:navigate', { detail })) })

describe('dojo:navigate (the native menu)', () => {
  it('goes to /settings from any screen, including a Do screen', async () => {
    await renderShell('/board')
    await screen.findByTestId('more-button')
    dispatch('/settings')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/settings'))
  })

  it('also leaves a full-screen Do route', async () => {
    await renderShell('/do/p127')
    await screen.findByTestId('do-screen')
    dispatch('/settings')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/settings'))
  })

  it('ignores anything that is not an in-app path', async () => {
    await renderShell('/board')
    dispatch('https://example.com')
    dispatch('//example.com')
    dispatch(42)
    dispatch(undefined)
    await new Promise(r => setTimeout(r, 50))
    expect(screen.getByTestId('where').textContent).toBe('/board')
  })
})

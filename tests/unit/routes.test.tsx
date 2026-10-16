import { readFileSync } from 'node:fs'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { AppRoutes } from '../../src/app/routes'
import { setNow } from '../../src/lib/clock'
import { freshDb, seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { mkAiTickets, mkPlanV2 } from '../helpers/planV2'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}

/** The flat-plan screens (Today, Path, Skills, Review, Do, Settings, Guide) read the v2 plan; the legacy four read the small v1 plan. */
async function renderAt(route: string, legacy = false) {
  setNow(() => ist('2026-11-04T10:00:00'))
  const d = legacy ? await seededDb() : freshDb()
  if (!legacy) {
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0, navLabels: 'hover' })
    await d.tickets.bulkPut(mkAiTickets())
  }
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[route]}>
      <AppProviders db={d} plan={flatPlanV2} planV2={legacy ? null : mkPlanV2()}>
        <AppRoutes />
        <Where />
      </AppProviders>
    </MemoryRouter>,
  )
}

/** The routes of the contract (Global Constraints) and the screen hook each one renders. */
const ROUTES: [string, string][] = [
  ['/', 'today'], ['/path', 'path'], ['/skills', 'skills'], ['/skills/area/llm', 'skills'], ['/skills/stats', 'skills'],
  ['/board', 'board'], ['/review', 'review'], ['/do/ai.l3.learn', 'do'], ['/designs/session/d-ratelimit', 'design-session'], ['/settings', 'settings'], ['/guide', 'guide'],
]
const LEGACY: [string, string][] = [['/dsa', 'dsa'], ['/designs', 'designs'], ['/atlas', 'atlas'], ['/banks', 'banks']]
const DELETED = ['/week', '/overview', '/mentors', '/ritual', '/map', '/progress', '/ai', '/no-such-page', '/ai/anything/else', '/board/x'] // /board itself is the Board again (board.md); a path under it still ends at Today

describe('routes (SHELL-20, SHELL-21)', () => {
  it.each(ROUTES)('%s renders screen-%s without redirecting', async (to, name) => {
    await renderAt(to)
    expect(screen.getByTestId('where').textContent).toBe(to)
    const root = await screen.findByTestId(`screen-${name}`) // screen-do is drawn with its ticket (RIT-69), so wait for it
    await waitFor(() => expect(root).toHaveAttribute('data-ready', 'true'), { timeout: 4000 })
    expect(root.querySelector('.loading')).toBeNull()
    expect(screen.queryByTestId('screen-error')).toBeNull()
  })

  it.each(LEGACY)('%s stays routed and renders screen-%s (off the nav)', async (to, name) => {
    await renderAt(to, true)
    expect(screen.getByTestId('where').textContent).toBe(to)
    const root = await screen.findByTestId(`screen-${name}`) // screen-do is drawn with its ticket (RIT-69), so wait for it
    await waitFor(() => expect(root).toHaveAttribute('data-ready', 'true'), { timeout: 4000 })
  })

  it.each(DELETED)('%s ends at / with screen-today', async from => {
    await renderAt(from)
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/'))
    expect(await screen.findByTestId('screen-today')).toBeInTheDocument()
    for (const gone of ['week', 'overview', 'mentors', 'ritual', 'map', 'progress', 'ai']) expect(screen.queryByTestId(`screen-${gone}`), gone).toBeNull()
  })

  it('replaces the history entry for a redirect (Back does not return to a deleted route)', () => {
    expect(readFileSync('src/app/routes.tsx', 'utf8')).toMatch(/<Navigate to="\/" replace \/>/)
  })

  it('Atlas and Banks render a real header with one purpose line', async () => {
    await renderAt('/atlas', true)
    expect(await screen.findByRole('heading', { level: 1, name: 'Atlas' })).toBeInTheDocument()
    expect(await screen.findByTestId('atlas-summary')).toHaveTextContent('16 atoms · 36 patterns · you have predicted 0')
  })

  it('Banks renders its header and bank switcher', async () => {
    await renderAt('/banks', true)
    expect(await screen.findByTestId('banks-page')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Banks' })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Banks' })).toBeInTheDocument()
  })

  it.each([['/designs/session/d-ratelimit'], ['/designs/session/d%20nope']])('the design session route renders "Design not found" for an id absent from the plan (%s), without redirecting', async route => {
    await renderAt(route)
    expect(screen.getByTestId('where').textContent).toBe(route)
    expect(await screen.findByRole('heading', { level: 1, name: 'Design not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Designs' })).toHaveAttribute('href', '/designs')
  })

  it('carries screen-do next to its own do-screen', async () => {
    await renderAt('/do/ai.l3.learn')
    const root = await screen.findByTestId('screen-do')
    await waitFor(() => expect(root).toHaveAttribute('data-ready', 'true'), { timeout: 4000 })
    expect(root.querySelector('[data-testid="do-screen"]')).not.toBeNull()
  })
})

describe('routes: bundle (R17)', () => {
  it('imports no screen statically except Today: everything else is lazy, so the entry chunk stays under budget', () => {
    const src = readFileSync('src/app/routes.tsx', 'utf8')
    const staticScreens = [...src.matchAll(/^import .* from '\.\.\/screens\/([^']+)'/gm)].map(m => m[1])
    expect(staticScreens).toEqual(['Today'])
    for (const s of ['Do', 'Path', 'Review', 'Skills', 'Guide', 'Settings', 'designSession/DesignSessionScreen', 'Dsa', 'Atlas', 'Designs', 'Banks']) {
      expect(src, s).toContain(`import('${['..', 'screens', s].join('/')}')`)
    }
  })
})

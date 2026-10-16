import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/app/App'
import { patchSettings } from '../../src/data/db'
import type { PlanV2 } from '../../src/data/planV2'
import { setNow } from '../../src/lib/clock'
import { failingDb, freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'

const serve = (status: number, body: () => Promise<unknown>): typeof fetch =>
  (async () => ({ ok: status >= 200 && status < 300, status, json: body }) as unknown as Response)
const ist = (s: string) => new Date(`${s}+05:30`).getTime()

async function readyDb() {
  const d = freshDb()
  await patchSettings(d, { startDate: '2026-09-07' })
  return d
}

describe('App boot (Review Focus #1, #2)', () => {
  afterEach(() => vi.restoreAllMocks())
  it('shows a clear error screen and seeds nothing when plan.json is missing', async () => {
    const d = freshDb()
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve(404, async () => ({}))} /></MemoryRouter>)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Plan data problem')
    expect(alert).toHaveTextContent('/data/plan.json returned HTTP 404')
    expect(await d.tickets.count()).toBe(0)
  })

  it('shows the error screen for an empty/unparsable body', async () => {
    const d = freshDb()
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve(200, async () => { throw new SyntaxError('x') })} /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('is not valid JSON')
  })

  it('shows the error screen, not a crash, for a malformed entry, and writes nothing', async () => {
    const d = freshDb()
    const bad = JSON.parse(JSON.stringify(flatPlanV2)) as PlanV2
    ;(bad.tickets[0] as { id?: string }).id = undefined
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve(200, async () => bad)} /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('plan v2: ticket without an id')
    expect(await d.tickets.count()).toBe(0)
  })

  it('shows a storage-specific error, distinct from a plan-data error, on a Dexie failure (minor #7)', async () => {
    const d = failingDb('settings')
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve(200, async () => flatPlanV2)} /></MemoryRouter>)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Browser storage unavailable (private mode or blocked?)')
    expect(alert).toHaveTextContent('boom')
    expect(alert).not.toHaveTextContent('Plan data problem')
  })

  it('MIG-01: every top-level error fallback carries screen-error, and keeps the fatal hook', async () => {
    // storage failure
    const d = failingDb('settings')
    const first = render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve(200, async () => flatPlanV2)} /></MemoryRouter>)
    expect(await screen.findByTestId('screen-error')).toHaveTextContent('Browser storage unavailable')
    expect(screen.getByTestId('fatal')).toContainElement(screen.getByTestId('screen-error'))
    first.unmount()
    // plan data failure
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={freshDb()} fetcher={serve(404, async () => ({}))} /></MemoryRouter>)
    expect(await screen.findByTestId('screen-error')).toHaveTextContent('Plan data problem')
    expect(screen.getByTestId('fatal')).toBeInTheDocument()
  })

  it('MIG-01: a healthy boot renders no screen-error', async () => {
    setNow(() => ist('2026-09-08T10:00:00'))
    const d = await readyDb()
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve(200, async () => flatPlanV2)} /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Today' })).toBeInTheDocument()
    expect(screen.queryByTestId('screen-error')).toBeNull()
  })

  it('boot seeds no artifact table: the AI capstone screen and its table are gone (v12)', async () => {
    setNow(() => ist('2026-09-08T10:00:00'))
    const d = await readyDb()
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve(200, async () => flatPlanV2)} /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Today' })).toBeInTheDocument()
    expect(d.tables.map(t => t.name)).not.toContain('artifacts')
  })

  it('SHELL-20: a deleted route opens Today inside the shell, with Today current and the other three items present', async () => {
    setNow(() => ist('2026-09-08T10:00:00'))
    const d = await readyDb()
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/week']}><App database={d} fetcher={serve(200, async () => flatPlanV2)} /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Today' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('screen-today')).toBeInTheDocument()
    for (const name of ['Path', 'Skills', 'Review']) expect(screen.getByRole('link', { name })).not.toHaveAttribute('aria-current')
    expect(screen.queryByTestId('screen-week')).toBeNull()
  })

  it('seeds once and renders the tabs, even under StrictMode double effects', async () => {
    setNow(() => ist('2026-09-08T10:00:00'))
    const d = await readyDb()
    render(
      <StrictMode>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve(200, async () => flatPlanV2)} /></MemoryRouter>
      </StrictMode>,
    )
    expect(await screen.findByRole('link', { name: 'Today' })).toBeInTheDocument()
    for (const name of ['Path', 'Skills', 'Review']) expect(screen.getByRole('link', { name })).toBeInTheDocument()
    expect(screen.queryByTestId('more-button')).toBeNull()
    await waitFor(async () => expect(await d.tickets.count()).toBe(10))
    expect(await d.events.count()).toBe(0)
  })
})

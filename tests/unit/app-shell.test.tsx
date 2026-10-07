import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/app/App'
import { patchSettings } from '../../src/data/db'
import type { PlanJson } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { failingDb, freshDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'

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
    const bad = JSON.parse(JSON.stringify(smallPlan)) as PlanJson
    ;(bad.sprints[0].ai[0] as { id?: string }).id = undefined
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve(200, async () => bad)} /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('sprint 1: task without an id')
    expect(await d.tickets.count()).toBe(0)
  })

  it('shows a storage-specific error, distinct from a plan-data error, on a Dexie failure (minor #7)', async () => {
    const d = failingDb('settings')
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve(200, async () => smallPlan)} /></MemoryRouter>)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Browser storage unavailable (private mode or blocked?)')
    expect(alert).toHaveTextContent('boom')
    expect(alert).not.toHaveTextContent('Plan data problem')
  })

  it('boots the app even when seeding the AI artifacts fails (chain P task 4)', async () => {
    setNow(() => ist('2026-09-08T10:00:00'))
    const d = failingDb('artifacts')
    // App logs the swallowed seed failure via console.warn; expected here, so keep it quiet in this test only
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await patchSettings(d, { startDate: '2026-09-07' })
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve(200, async () => smallPlan)} /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Today' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('seeds once and renders the tabs, even under StrictMode double effects', async () => {
    setNow(() => ist('2026-09-08T10:00:00'))
    const d = await readyDb()
    render(
      <StrictMode>
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve(200, async () => smallPlan)} /></MemoryRouter>
      </StrictMode>,
    )
    expect(await screen.findByRole('link', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Board' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'DSA' })).toBeInTheDocument()
    expect(screen.getByTestId('more-button')).toBeInTheDocument()
    await waitFor(async () => expect(await d.tickets.count()).toBe(10))
    expect(await d.events.count()).toBe(0)
  })
})

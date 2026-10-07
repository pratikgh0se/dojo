import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { Shell } from '../../src/app/Shell'
import type { DojoDB } from '../../src/data/db'
import { setNow } from '../../src/lib/clock'
import { loadStudy } from '../../src/lib/studyStore'
import { loadTimer } from '../../src/lib/timer'
import { beginStudy, finishStudy, runTick } from '../../src/study/runner'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'

// Ruling 24 S1 (computer-use UAT cu-2 P2-1): a running study session is visible on every screen, the NOW tile shows its
// running state, End ends the session itself, and a session is never left running out of sight.
const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const MON = ist('2026-09-07T21:10:00') // Monday: AI watch, the NOW card is m1w1t1
const MIN = 60_000
let clock = MON

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>
}
const fx = () => ({ chime: vi.fn(), toast: vi.fn(), onError: vi.fn() })
const plan = { goal: 'trace it', focusMin: 25, breakMin: 5, cardIds: [] as string[], chime: false }

async function startOn(d: DojoDB, id: string) {
  const t = (await d.tickets.get(id))!
  expect(await beginStudy({ d, ticket: t, plan: { ...plan, cardIds: [id] }, nowMs: clock, ...fx() })).toBe(true)
}

async function shellAt(route: string, opts: { session?: string } = {}) {
  clock = MON
  setNow(() => clock)
  const d = await seededDb()
  if (opts.session) await startOn(d, opts.session)
  const view = render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[route]}>
      <AppProviders db={d} plan={smallPlan}>
        <Shell />
        <Where />
      </AppProviders>
    </MemoryRouter>,
  )
  await screen.findByTestId(route.startsWith('/do/') ? 'do-screen' : 'more-button')
  return { d, view }
}
const at = () => screen.getByTestId('where').textContent
/** Move the fake wall clock and let the runner's 1 s tick notice it. */
async function elapse(min: number, then: () => void) {
  clock += min * MIN
  await waitFor(then, { timeout: 4000 })
}

describe('the session pill (header strip)', () => {
  it('is not there while no session is stored', async () => {
    await shellAt('/board')
    expect(screen.queryByTestId('session-pill')).toBeNull()
    expect(screen.queryByTestId('session-strip')).toBeNull()
  })

  it.each(['/board', '/dsa', '/settings'])('shows phase · time left · card title on %s', async route => {
    await shellAt(route, { session: 'p127' })
    const pill = await screen.findByTestId('session-pill')
    expect(within(pill).getByTestId('session-pill-phase')).toHaveTextContent(/^Focus$/)
    expect(within(pill).getByTestId('session-pill-time')).toHaveTextContent('25:00')
    expect(within(pill).getByTestId('session-pill-title')).toHaveTextContent((await (await seededDb()).tickets.get('p127'))!.title)
    expect(pill).toHaveAttribute('data-phase', 'focus')
  })

  it('counts down with the clock and names the break and the long break', async () => {
    await shellAt('/board', { session: 'p127' })
    await screen.findByTestId('session-pill')
    await elapse(10, () => expect(screen.getByTestId('session-pill-time')).toHaveTextContent('15:00'))
    await elapse(15, () => expect(screen.getByTestId('session-pill-phase')).toHaveTextContent(/^Break$/))
    expect(screen.getByTestId('session-pill')).toHaveAttribute('data-phase', 'break')
  })

  it('Pause holds the clock and the button reads Resume; Resume runs it on', async () => {
    await shellAt('/week', { session: 'p127' })
    await screen.findByTestId('session-pill')
    await elapse(5, () => expect(screen.getByTestId('session-pill-time')).toHaveTextContent('20:00'))
    fireEvent.click(screen.getByTestId('session-pill-pause'))
    expect(screen.getByTestId('session-pill-phase')).toHaveTextContent('Focus · paused')
    expect(screen.getByTestId('session-pill')).toHaveAttribute('data-paused', 'true')
    expect(loadStudy()!.paused).toBe(20 * MIN)
    expect(loadTimer()).toMatchObject({ running: false })
    clock += 7 * MIN
    await act(async () => { await new Promise(r => setTimeout(r, 1300)) })
    expect(screen.getByTestId('session-pill-time')).toHaveTextContent('20:00')
    fireEvent.click(screen.getByTestId('session-pill-resume'))
    expect(screen.getByTestId('session-pill-phase')).toHaveTextContent(/^Focus$/)
    expect(loadStudy()!.paused).toBeNull()
    expect(loadTimer()).toMatchObject({ running: true })
    await elapse(1, () => expect(screen.getByTestId('session-pill-time')).toHaveTextContent('19:00'))
  })

  it('a click on the pill returns to that card\'s Do', async () => {
    await shellAt('/board', { session: 'p127' })
    fireEvent.click(await screen.findByTestId('session-pill-link'))
    await waitFor(() => expect(at()).toBe('/do/p127'))
  })

  it('on the session card\'s own Do page the pill docks under the rail with Pause and Resume (UAT cu-2p P3-6)', async () => {
    await shellAt('/do/p127', { session: 'p127' })
    await screen.findByTestId('session-panel')
    const dock = await screen.findByTestId('session-dock')
    expect(screen.getAllByTestId('session-pill')).toHaveLength(1)
    // the panel has no Pause of its own (ruling 26 D3.6): the pill's is the one
    expect(within(screen.getByTestId('session-panel')).queryByRole('button', { name: /^(Pause|Resume)$/ })).toBeNull()
    fireEvent.click(within(dock).getByTestId('session-pill-pause'))
    await waitFor(() => expect(within(screen.getByTestId('session-dock')).getByTestId('session-pill-resume')).toBeInTheDocument())
    fireEvent.click(within(screen.getByTestId('session-dock')).getByTestId('session-pill-resume'))
    await waitFor(() => expect(within(screen.getByTestId('session-dock')).getByTestId('session-pill-pause')).toBeInTheDocument())
  })

  it('on another card\'s Do page the pill docks under the rail', async () => {
    await shellAt('/do/m1w1t1', { session: 'p127' })
    const dock = await screen.findByTestId('session-dock')
    expect(within(dock).getByTestId('session-pill-time')).toHaveTextContent(/^\d\d:\d\d$/)
    expect(within(dock).getByTestId('session-pill-link')).toHaveAttribute('href', '/do/p127')
    // Do has no header strip: one pill only
    expect(screen.getAllByTestId('session-pill')).toHaveLength(1)
  })

  it('a session parked as away says so and offers no pause', async () => {
    const { d } = await shellAt('/board', { session: 'p127' })
    await screen.findByTestId('session-pill')
    clock += 300 * MIN
    await act(async () => { await runTick(d, clock, fx()) })
    const pill = await screen.findByTestId('session-pill')
    await waitFor(() => expect(pill).toHaveAttribute('data-phase', 'away'))
    expect(within(pill).getByTestId('session-pill-phase')).toHaveTextContent('Away')
    expect(within(pill).queryByRole('button')).toBeNull()
    expect(await screen.findByRole('dialog', { name: 'Welcome back' })).toBeInTheDocument()
  })

  it('goes away when the session ends', async () => {
    const { d } = await shellAt('/board', { session: 'p127' })
    await screen.findByTestId('session-pill')
    expect(await finishStudy({ d, log: { done: '', stuckOn: '', nextStep: '' }, nowMs: clock, ...fx() })).toBe(true)
    await waitFor(() => expect(screen.queryByTestId('session-pill')).toBeNull())
    expect(screen.queryByTestId('session-strip')).toBeNull()
  })

  it('comes back after a reload with the clock still right', async () => {
    const { d, view } = await shellAt('/board', { session: 'p127' })
    await screen.findByTestId('session-pill')
    clock += 8 * MIN
    view.unmount() // a reload: the stored session is all that is left
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/progress']}>
        <AppProviders db={d} plan={smallPlan}><Shell /><Where /></AppProviders>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId('session-pill-time')).toHaveTextContent('17:00')
    expect(screen.getByTestId('session-pill-phase')).toHaveTextContent(/^Focus$/)
    expect(screen.queryByRole('dialog', { name: 'Welcome back' })).toBeNull() // within 2 minutes of a phase end there is no gap
  })
})

import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { patchSettings } from '../../src/data/db'
import type { Ticket } from '../../src/data/types'
import { clearStudy } from '../../src/lib/studyStore'
import { Do } from '../../src/screens/Do'
import { Path } from '../../src/screens/Path'
import { Settings } from '../../src/screens/Settings'
import { useCompleteTicket } from '../../src/study/useCompleteTicket'
import { useStartTicket } from '../../src/study/useStartTicket'
import { seededDb, freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { appPlans, mkPlanV2, mkTicket as mkPlanTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

// GLOBAL-07: safeWrite absorbs only quota and read-only refusals and rethrows anything else. Every fire-and-forget caller must
// turn such a throw into one short toast, never an unhandled rejection that silently does nothing.
const boom = vi.hoisted(() => ({ on: false, completeRejects: false }))
const fail = (): never => { throw new Error('disk exploded') }

vi.mock('../../src/data/sessionActions', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/data/sessionActions')>()
  return { ...real, startDoing: (...a: Parameters<typeof real.startDoing>) => (boom.on ? fail() : real.startDoing(...a)) }
})
vi.mock('../../src/data/queueActions', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/data/queueActions')>()
  return { ...real, reorderInLane: (...a: Parameters<typeof real.reorderInLane>) => (boom.on ? fail() : real.reorderInLane(...a)) }
})
vi.mock('../../src/data/settingsActions', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/data/settingsActions')>()
  return {
    ...real,
    saveLaneBudgets: (...a: Parameters<typeof real.saveLaneBudgets>) => (boom.on ? fail() : real.saveLaneBudgets(...a)),
    saveSessionMinutes: (...a: Parameters<typeof real.saveSessionMinutes>) => (boom.on ? fail() : real.saveSessionMinutes(...a)),
    saveNavLabels: (...a: Parameters<typeof real.saveNavLabels>) => (boom.on ? fail() : real.saveNavLabels(...a)),
    saveStartDate: (...a: Parameters<typeof real.saveStartDate>) => (boom.on ? fail() : real.saveStartDate(...a)),
  }
})
vi.mock('../../src/study/useCompleteTicket', async importOriginal => {
  const real = await importOriginal<typeof import('../../src/study/useCompleteTicket')>()
  return {
    ...real,
    useCompleteTicket: () => {
      const complete = real.useCompleteTicket()
      return (t: Ticket) => (boom.completeRejects ? Promise.reject(new Error('disk exploded')) : complete(t))
    },
  }
})
vi.mock('../../src/runner/CodeEditor', () => ({ default: () => null }))

afterEach(() => { cleanup(); clearStudy(); boom.on = false; boom.completeRejects = false; vi.restoreAllMocks() })

/** Runs `act` and returns every unhandled rejection raised until the event loop has gone quiet. */
async function unhandledDuring(act: () => Promise<void> | void): Promise<unknown[]> {
  const seen: unknown[] = []
  const on = (e: unknown) => { seen.push(e) }
  process.on('unhandledRejection', on)
  try {
    await act()
    await new Promise(r => setTimeout(r, 80))
  } finally {
    process.off('unhandledRejection', on)
  }
  return seen
}

function Harness({ ticket }: { ticket: Ticket }) {
  const start = useStartTicket()
  const complete = useCompleteTicket()
  return (
    <>
      <button onClick={() => void start(ticket)}>start</button>
      <button onClick={() => void complete(ticket)}>done</button>
    </>
  )
}

describe('useStartTicket / useCompleteTicket: an unexpected throw', () => {
  it('start: a failing startDoing (design ticket) toasts one sentence, navigates nowhere and can be retried', async () => {
    const d = await seededDb()
    const ticket = (await d.tickets.toArray()).find(t => t.status === 'todo' && t.kind === 'design')!
    renderWithApp(<Harness ticket={ticket} />, { db: d, plan: flatPlanV2 })
    boom.on = true
    const seen = await unhandledDuring(() => { fireEvent.click(screen.getByText('start')) })
    expect(seen).toEqual([])
    expect(await screen.findByText('Could not start that ticket. Try again.')).toBeInTheDocument()
    expect(screen.getByTestId('location')).not.toHaveTextContent('/designs/session/')
    boom.on = false // the in-flight guard was released: the next click starts it
    fireEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/designs/session/${ticket.id}`))
  })

  it('start: a failing settings read (study ticket) toasts one sentence and starts nothing', async () => {
    const d = await seededDb()
    await patchSettings(d, { sessionMinutes: 25 })
    const ticket = (await d.tickets.toArray()).find(t => t.status === 'todo' && t.kind !== 'design' && t.kind !== 'writeup')!
    renderWithApp(<Harness ticket={ticket} />, { db: d, plan: flatPlanV2 })
    vi.spyOn(d.settings, 'get').mockRejectedValue(new Error('disk exploded'))
    const seen = await unhandledDuring(() => { fireEvent.click(screen.getByText('start')) })
    expect(seen).toEqual([])
    expect(await screen.findByText('Could not start that ticket. Try again.')).toBeInTheDocument()
    expect(screen.getByTestId('location')).not.toHaveTextContent('/do/')
    vi.restoreAllMocks()
    fireEvent.click(screen.getByText('start'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/do/${ticket.id}`))
  })

  it('complete: a failing ticket read (outside the guarded write) toasts one sentence and never rejects', async () => {
    const d = await seededDb()
    const ticket = (await d.tickets.toArray()).find(t => t.status === 'todo' && t.kind !== 'design')!
    renderWithApp(<Harness ticket={ticket} />, { db: d, plan: flatPlanV2 })
    vi.spyOn(d.tickets, 'get').mockRejectedValue(new Error('disk exploded'))
    const seen = await unhandledDuring(() => { fireEvent.click(screen.getByText('done')) })
    expect(seen).toEqual([])
    expect(await screen.findByText('Could not finish that ticket. Try again.')).toBeInTheDocument()
    vi.restoreAllMocks()
    expect(screen.getByText('done')).toBeEnabled()
    expect((await d.tickets.get(ticket.id))!.status).toBe('todo')
  })
})

describe('Ticket view: Done', () => {
  it('a rejecting completion toasts one sentence and leaves Done usable', async () => {
    const watch = mkPlanTicket({ id: 'w1', kind: 'watch', lane: 'path', title: 'Watch: a talk', estMin: 30, links: [{ label: 'Video', url: 'https://youtu.be/abc' }] })
    clearStudy()
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.bulkPut([watch])
    renderWithApp(<Do />, { db: d, ...appPlans(), route: '/do/w1', path: '/do/:ticketId' })
    fireEvent.click(await screen.findByTestId('ticket-start'))
    const done = await screen.findByTestId('ticket-done')
    boom.completeRejects = true
    const seen = await unhandledDuring(() => { fireEvent.click(done) })
    expect(seen).toEqual([])
    expect(await screen.findByText('Could not finish that ticket. Try again.')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-done')).toBeEnabled()
    expect((await d.tickets.get('w1'))!.status).not.toBe('done')
  })
})

describe('Path: reorder and move to Doing', () => {
  const plans = appPlans({ phases: mkPlanV2().phases.map(p => ({ ...p, authored: true })) })
  const dt = { setData: vi.fn(), effectAllowed: '', types: ['text/plain'] }
  async function setup() {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.bulkPut(Array.from({ length: 4 }, (_, i) => mkPlanTicket({ id: `dsa-${i + 1}`, lane: 'dsa', kind: 'problem', title: `dsa ticket ${i + 1}`, order: 2 + i * 3, estMin: 30 })))
    renderWithApp(<Path />, { db: d, ...plans })
    await screen.findByTestId('path-upnext')
    return d
  }

  it('a failing reorder toasts one sentence and the rows stay draggable', async () => {
    const d = await setup()
    boom.on = true
    const seen = await unhandledDuring(() => {
      fireEvent.dragStart(screen.getByTestId('row-dsa-4'), { dataTransfer: dt })
      fireEvent.drop(screen.getByTestId('row-dsa-2'), { dataTransfer: dt })
    })
    expect(seen).toEqual([])
    expect(await screen.findByText('Could not move that ticket. Try again.')).toBeInTheDocument()
    expect((await d.tickets.get('dsa-4'))!.orderOverride).toBeUndefined()
    boom.on = false
    fireEvent.dragStart(screen.getByTestId('row-dsa-4'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('row-dsa-2'), { dataTransfer: dt })
    await waitFor(async () => expect((await d.tickets.get('dsa-4'))!.orderOverride).toBeDefined())
  })

  it('a failing move to Doing toasts one sentence and the ticket stays in Up next', async () => {
    const d = await setup()
    boom.on = true
    const seen = await unhandledDuring(() => {
      fireEvent.dragStart(screen.getByTestId('row-dsa-3'), { dataTransfer: dt })
      fireEvent.drop(screen.getByTestId('path-doing'), { dataTransfer: dt })
    })
    expect(seen).toEqual([])
    expect(await screen.findByText('Could not start that ticket. Try again.')).toBeInTheDocument()
    expect((await d.tickets.get('dsa-3'))!.status).toBe('todo')
    boom.on = false
    fireEvent.dragStart(screen.getByTestId('row-dsa-3'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('path-doing'), { dataTransfer: dt })
    await waitFor(async () => expect((await d.tickets.get('dsa-3'))!.status).toBe('doing'))
  })
})

describe('Settings: a failing save', () => {
  async function setup() {
    const d = await seededDb(flatPlanV2, '2026-11-02')
    renderWithApp(<Settings />, { db: d, plan: flatPlanV2, route: '/settings' })
    await screen.findByTestId('settings-pace')
    return d
  }

  it('pace: a failing budget save toasts one sentence and the field stays editable', async () => {
    await setup()
    boom.on = true
    const seen = await unhandledDuring(() => { fireEvent.change(screen.getByTestId('settings-budget-1'), { target: { value: '120' } }) })
    expect(seen).toEqual([])
    expect(await screen.findByText('Could not save that pace. Try again.')).toBeInTheDocument()
    expect(screen.getByTestId('settings-budget-1')).toBeEnabled()
  })

  it('preferences: a failing session length and a failing switch each toast one sentence', async () => {
    await setup()
    boom.on = true
    const seen = await unhandledDuring(() => {
      fireEvent.change(screen.getByTestId('settings-session-minutes'), { target: { value: '40' } })
      fireEvent.click(screen.getByTestId('settings-nav-labels'))
    })
    expect(seen).toEqual([])
    expect((await screen.findAllByText('Could not save that setting. Try again.')).length).toBeGreaterThan(0)
    expect(screen.getByTestId('settings-session-minutes')).toBeEnabled()
  })

  it('plan start: a failing save toasts one sentence and the form stays usable', async () => {
    await setup()
    boom.on = true
    const seen = await unhandledDuring(() => { fireEvent.click(screen.getByRole('button', { name: 'Save start date' })) })
    expect(seen).toEqual([])
    expect(await screen.findByText('Could not save the start date. Try again.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save start date' })).toBeEnabled()
  })
})

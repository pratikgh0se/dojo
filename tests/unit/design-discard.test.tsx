import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { enterScore, lockDesignSession, startDesignSession } from '../../src/data/designSessionActions'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// DESIGN-80: discard a session in progress; Task 16b.
const T = new Date('2026-10-11T10:00:00+05:30').getTime()
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
type Mode = 'solo' | 'ai-partner' | 'human-partner'
type Db = Awaited<ReturnType<typeof seededDb>>
const CLOSE = { tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 3 as const, readNext: 'z' }
const PHASES = {
  drawing: async () => {},
  close: async (d: Db, id: string) => { await lockDesignSession(d, id, T) },
  score: async (d: Db, id: string) => { await lockDesignSession(d, id, T); await enterScore(d, id, CLOSE) },
}

async function open(mode: Mode, phase: keyof typeof PHASES | 'done', designId = 'd-method', existing?: Db) {
  setNow(() => T)
  const d = existing ?? await seededDb()
  const s = await startDesignSession(d, { designId, mode, deepDives: DIVES, nowMs: T - MIN })
  let route = `/designs/session/${designId}`
  if (phase === 'done') {
    await d.designSessions.update(s.id, { phase: 'done', endedAt: T })
    route += `?session=${s.id}`
  } else await PHASES[phase](d, s.id)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route, path: '/designs/session/:designId' })
  await screen.findByTestId('session-phase')
  await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveAttribute('data-phase', phase))
  return { d, id: s.id }
}
const tid = (id: string) => screen.getByTestId(id)
const dialog = () => screen.getByRole('dialog', { name: 'Discard this session?' })

describe('discard a session in progress (DESIGN-80)', () => {
  it.each(['drawing', 'close', 'score'] as const)('cancel in the %s phase changes nothing', async phase => {
    const { d, id } = await open('solo', phase)
    const before = await d.designSessions.get(id)
    fireEvent.click(tid('session-discard'))
    fireEvent.click(within(dialog()).getByTestId('session-discard-cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(tid('session-phase')).toHaveAttribute('data-phase', phase)
    expect(screen.queryByTestId('session-setup')).toBeNull()
    expect(await d.designSessions.get(id)).toEqual(before)
  })

  it.each([
    ['solo', 'drawing'], ['ai-partner', 'drawing'], ['human-partner', 'drawing'],
    ['solo', 'close'], ['ai-partner', 'close'], ['human-partner', 'close'],
    ['solo', 'score'], ['ai-partner', 'score'], ['human-partner', 'score'],
  ] as const)('confirm in %s / %s removes the row and shows the setup for the same ticket; the ticket is unchanged', async (mode, phase) => {
    const { d, id } = await open(mode, phase)
    const tickets = await d.tickets.toArray()
    expect(tickets.length).toBeGreaterThan(0)
    fireEvent.click(tid('session-discard'))
    fireEvent.click(within(dialog()).getByTestId('session-discard-confirm'))
    await waitFor(() => expect(tid('session-phase')).toHaveAttribute('data-phase', 'setup'))
    expect(tid('session-setup')).toBeInTheDocument()
    expect(screen.queryByTestId('session-discard')).toBeNull()
    expect(await d.designSessions.get(id)).toBeUndefined()
    expect(await d.designSessions.count()).toBe(0)
    expect(await d.tickets.toArray()).toEqual(tickets)
  })

  it('a finished session has no session-discard', async () => {
    await open('solo', 'done')
    expect(screen.queryByTestId('session-discard')).toBeNull()
    expect(tid('session-phase')).toHaveTextContent(/^Done$/)
  })

  it('the dialog is a modal confirm: Esc cancels, nothing is written', async () => {
    const { d, id } = await open('ai-partner', 'drawing')
    fireEvent.click(tid('session-discard'))
    fireEvent.keyDown(dialog(), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await d.designSessions.get(id)).toBeDefined()
  })

  it('three sessions on three tickets, discarding between, each start fresh (DESIGN-04)', async () => {
    const d = await seededDb()
    for (const [designId, mode] of [['d-method', 'ai-partner'], ['d-estimate', 'human-partner'], ['d-method', 'solo']] as const) {
      await open(mode, 'drawing', designId, d)
      expect(await d.designSessions.count()).toBe(1)
      expect((await d.designSessions.toArray())[0]).toMatchObject({ designId, mode })
      fireEvent.click(tid('session-discard'))
      fireEvent.click(within(dialog()).getByTestId('session-discard-confirm'))
      await waitFor(() => expect(tid('session-phase')).toHaveAttribute('data-phase', 'setup'))
      expect(await d.designSessions.count()).toBe(0)
      cleanup()
    }
  })
})

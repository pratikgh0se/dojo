import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { startDesignSession } from '../../src/data/designSessionActions'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { flatPlanProse } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-11T10:00:00')
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
const TITLE = 'The method, on a whiteboard, in 45 minutes'

async function open(route = '/designs/session/d-method', at = T) {
  setNow(() => at)
  const d = await seededDb()
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, route, path: '/designs/session/:designId' })
  return d
}
const phase = () => screen.getByTestId('session-phase')

describe('DesignSessionScreen', () => {
  it('shows Design not found for an unknown id (D-4)', async () => {
    await open('/designs/session/d-nope')
    expect(await screen.findByRole('heading', { name: 'Design not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Designs' })).toHaveAttribute('href', '/designs')
  })

  it('shows the setup panel (D-1)', async () => {
    await open()
    expect(await screen.findByRole('heading', { level: 1, name: TITLE })).toBeInTheDocument()
    expect(phase()).toHaveTextContent('Setup')
    expect(phase()).toHaveAttribute('data-phase', 'setup')
    const setup = screen.getByTestId('session-setup')
    DIVES.forEach((q, i) => expect(within(setup).getByTestId(`session-dive-${i + 1}`)).toHaveTextContent(q))
    expect(within(setup).getByRole('link', { name: /Hello Interview free guides/ })).toBeInTheDocument()
    expect(within(screen.getByRole('radiogroup', { name: 'Partner' })).getByRole('radio', { name: /Solo · AI partner/ })).toBeChecked()
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent('45:00')
    expect(screen.getByRole('link', { name: '‹ Back' })).toHaveAttribute('href', '/designs')
  })

  it('starts a solo session (D-3)', async () => {
    const d = await open()
    fireEvent.click(await screen.findByTestId('design-mode-skip-ai'))
    fireEvent.click(screen.getByTestId('session-start'))
    await waitFor(() => expect(phase()).toHaveTextContent('Drawing'))
    expect(screen.getByTestId('session-timer')).toHaveTextContent('45:00')
    expect(screen.queryByTestId('session-interviewer')).toBeNull()
    expect(screen.getByTestId('session-dive-4')).toHaveTextContent('Failure modes')
    expect(await d.designSessions.count()).toBe(1)
  })

  it('resumes an open session with a derived timer (D-9, D-10)', async () => {
    setNow(() => T)
    const d = await seededDb()
    await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 10 * MIN })
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, route: '/designs/session/d-method', path: '/designs/session/:designId' })
    await waitFor(() => expect(phase()).toHaveTextContent('Drawing'))
    expect(screen.getByTestId('session-timer')).toHaveTextContent('35:00')
  })

  it('locks a session found hours later at exactly 45 minutes (Review Focus #1)', async () => {
    setNow(() => T)
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 5 * 60 * MIN })
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, route: '/designs/session/d-method', path: '/designs/session/:designId' })
    await waitFor(() => expect(phase()).toHaveTextContent('Close'))
    expect(screen.getByTestId('session-timer')).toHaveTextContent('00:00')
    expect(screen.getByText('Canvas locked at 45 minutes')).toBeInTheDocument()
    expect(await d.designSessions.get(s.id)).toMatchObject({ minutes: 45, lockedAt: T - 5 * 60 * MIN + 45 * MIN })
  })

  it('CLOSE · DESIGN ends drawing at once, with no confirm dialog (D-8, R-F2)', async () => {
    setNow(() => T)
    const d = await seededDb()
    await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 12 * MIN })
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, route: '/designs/session/d-method', path: '/designs/session/:designId' })
    expect(await screen.findByTestId('session-close-design')).toHaveTextContent('CLOSE · DESIGN')
    fireEvent.click(screen.getByTestId('session-close-design'))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(phase()).toHaveTextContent('Close'))
    expect(screen.getByTestId('session-timer')).toHaveTextContent('33:00')
    expect(screen.getByText('Canvas locked')).toBeInTheDocument()
    expect((await d.designSessions.toArray())[0].minutes).toBe(12)
  })

  it('discards back to setup (D-11)', async () => {
    const d = await open()
    fireEvent.click(await screen.findByTestId('design-mode-skip-ai'))
    fireEvent.click(await screen.findByTestId('session-start'))
    fireEvent.click(await screen.findByTestId('session-discard'))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard this session?' })).getByTestId('session-discard-cancel'))
    expect(phase()).toHaveTextContent('Drawing')
    fireEvent.click(screen.getByTestId('session-discard'))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard this session?' })).getByTestId('session-discard-confirm'))
    await waitFor(() => expect(phase()).toHaveTextContent('Setup'))
    expect(screen.getByTestId('session-timer')).toHaveTextContent('45:00')
    expect(await d.designSessions.count()).toBe(0)
  })

  it('shows Session not found for an unknown ?session id', async () => {
    await open('/designs/session/d-method?session=nope')
    expect(await screen.findByRole('heading', { name: 'Session not found' })).toBeInTheDocument()
  })

  it('opens a canvas whose frame lists a missing block without writing; the first edit stores the frame pruned (DESIGN-38)', async () => {
    setNow(() => T)
    const d = await seededDb()
    const row = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 10 * MIN })
    const canvas = {
      layout: 'manual' as const, links: [], flows: [] as never[], notes: [],
      nodes: [{ id: 'sql-1', kind: 'sql', label: 'Sql 1', x: 1, y: 1 }],
      zones: [{ id: 'frame-1', label: 'Write path', kind: 'system', nodes: ['ghost', 'sql-1'] }],
    }
    await d.designSessions.update(row.id, { canvas })
    const storedFrame = async () => ((await d.designSessions.get(row.id))?.canvas as unknown as typeof canvas).zones[0].nodes
    renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanProse, route: '/designs/session/d-method', path: '/designs/session/:designId' })
    await waitFor(() => expect(phase()).toHaveTextContent('Drawing'))
    await screen.findByTestId('kit-node-sql-1')
    expect(await storedFrame()).toEqual(['ghost', 'sql-1'])
    fireEvent.keyDown(screen.getByTestId('kit-node-sql-1'), { key: 'ArrowRight' })
    await waitFor(async () => expect(await storedFrame()).toEqual(['sql-1']))
  })
})

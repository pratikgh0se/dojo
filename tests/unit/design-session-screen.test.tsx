import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { startDesignSession } from '../../src/data/designSessionActions'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-11T10:00:00')
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
const TITLE = 'The method, on a whiteboard, in 45 minutes'

async function open(route = '/designs/session/d-method', at = T) {
  setNow(() => at)
  const d = await seededDb()
  renderWithApp(<DesignSessionScreen />, { db: d, plan: smallPlan, route, path: '/designs/session/:designId' })
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
    expect(phase()).toHaveTextContent('setup')
    expect(phase()).toHaveAttribute('data-phase', 'setup')
    const setup = screen.getByTestId('session-setup')
    DIVES.forEach((q, i) => expect(within(setup).getByTestId(`session-dive-${i + 1}`)).toHaveTextContent(q))
    expect(within(setup).getByRole('link', { name: /Hello Interview free guides/ })).toBeInTheDocument()
    expect(within(screen.getByRole('radiogroup', { name: 'Mode' })).getByRole('radio', { name: 'Solo' })).toBeChecked()
    expect(screen.getByRole('timer', { name: 'Time left' })).toHaveTextContent('45:00')
    expect(screen.getByRole('link', { name: '‹ Back' })).toHaveAttribute('href', '/designs')
  })

  it('starts a solo session (D-3)', async () => {
    const d = await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Start · 45 min' }))
    await waitFor(() => expect(phase()).toHaveTextContent('drawing'))
    expect(screen.getByTestId('session-timer')).toHaveTextContent('45:00')
    expect(screen.queryByTestId('session-interviewer')).toBeNull()
    expect(screen.getByTestId('session-dive-4')).toHaveTextContent('Failure modes')
    expect(await d.designSessions.count()).toBe(1)
  })

  it('resumes an open session with a derived timer (D-9, D-10)', async () => {
    setNow(() => T)
    const d = await seededDb()
    await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 10 * MIN })
    renderWithApp(<DesignSessionScreen />, { db: d, plan: smallPlan, route: '/designs/session/d-method', path: '/designs/session/:designId' })
    await waitFor(() => expect(phase()).toHaveTextContent('drawing'))
    expect(screen.getByTestId('session-timer')).toHaveTextContent('35:00')
  })

  it('locks a session found hours later at exactly 45 minutes (Review Focus #1)', async () => {
    setNow(() => T)
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 5 * 60 * MIN })
    renderWithApp(<DesignSessionScreen />, { db: d, plan: smallPlan, route: '/designs/session/d-method', path: '/designs/session/:designId' })
    await waitFor(() => expect(phase()).toHaveTextContent('close'))
    expect(screen.getByTestId('session-timer')).toHaveTextContent('00:00')
    expect(screen.getByText('Canvas locked at 45 minutes')).toBeInTheDocument()
    expect(await d.designSessions.get(s.id)).toMatchObject({ minutes: 45, lockedAt: T - 5 * 60 * MIN + 45 * MIN })
  })

  it('ends drawing through the confirm dialog (D-8)', async () => {
    setNow(() => T)
    const d = await seededDb()
    await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 12 * MIN })
    renderWithApp(<DesignSessionScreen />, { db: d, plan: smallPlan, route: '/designs/session/d-method', path: '/designs/session/:designId' })
    fireEvent.click(await screen.findByRole('button', { name: 'End drawing' }))
    const dlg = screen.getByRole('dialog', { name: 'End drawing now?' })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Keep going' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(phase()).toHaveTextContent('drawing')
    fireEvent.click(screen.getByRole('button', { name: 'End drawing' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'End drawing now?' })).getByRole('button', { name: 'End drawing' }))
    await waitFor(() => expect(phase()).toHaveTextContent('close'))
    expect(screen.getByTestId('session-timer')).toHaveTextContent('33:00')
    expect(screen.getByText('Canvas locked')).toBeInTheDocument()
    expect((await d.designSessions.toArray())[0].minutes).toBe(12)
  })

  it('discards back to setup (D-11)', async () => {
    const d = await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Start · 45 min' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Discard session' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard this session?' })).getByRole('button', { name: 'Cancel' }))
    expect(phase()).toHaveTextContent('drawing')
    fireEvent.click(screen.getByRole('button', { name: 'Discard session' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard this session?' })).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(phase()).toHaveTextContent('setup'))
    expect(screen.getByTestId('session-timer')).toHaveTextContent('45:00')
    expect(await d.designSessions.count()).toBe(0)
  })

  it('shows Session not found for an unknown ?session id', async () => {
    await open('/designs/session/d-method?session=nope')
    expect(await screen.findByRole('heading', { name: 'Session not found' })).toBeInTheDocument()
  })
})

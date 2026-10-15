import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { pauseDesignSession, startDesignSession } from '../../src/data/designSessionActions'
import { resetNow, setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const T = new Date('2026-10-11T10:00:00+05:30').getTime()
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
type Mode = 'solo' | 'ai-partner' | 'human-partner'
const tid = (id: string) => screen.getByTestId(id)

async function open(mode: Mode, opts: { ageMin: number; paused?: boolean }) {
  let clock = T
  setNow(() => clock)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode, deepDives: DIVES, nowMs: T - opts.ageMin * MIN })
  if (opts.paused) await pauseDesignSession(d, s.id, T)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method', path: '/designs/session/:designId' })
  await screen.findByTestId('session-footer')
  return { d, id: s.id, advance: (ms: number) => { clock += ms } }
}

afterEach(() => resetNow())

describe('Pause on the live session (F2)', () => {
  it('Pause stops the clock, reads Resume and Paused, shows the banner and makes the work read-only', async () => {
    const { d, id } = await open('solo', { ageMin: 10 })
    expect(tid('session-pause')).toHaveTextContent(/^Pause$/)
    expect(screen.queryByTestId('session-paused')).toBeNull()
    fireEvent.click(tid('session-pause'))
    await waitFor(() => expect(tid('session-pause')).toHaveTextContent(/^Resume$/))
    expect(tid('session-phase')).toHaveTextContent(/^Paused$/)
    expect(tid('session-phase')).toHaveAttribute('data-phase', 'drawing')
    expect(tid('session-paused')).toHaveTextContent('Paused. The clock is stopped.')
    expect((await d.designSessions.get(id))!.pausedAt).toBe(T)
    expect(tid('notes-field-req-fn')).toHaveAttribute('readonly')
    expect(tid('kit-add-custom')).toBeDisabled()
    expect(tid('session-timer')).toHaveTextContent('35:00')
    // sections can still be opened while paused
    fireEvent.click(tid('notes-section-api-toggle'))
    expect(tid('notes-field-api')).toBeVisible()
    expect(tid('notes-field-api')).toHaveAttribute('readonly')
  })
  it('Resume starts it again and adds the pause to pausedMs', async () => {
    const { d, id, advance } = await open('solo', { ageMin: 10, paused: true })
    expect(tid('session-pause')).toHaveTextContent(/^Resume$/)
    advance(5 * MIN)
    fireEvent.click(tid('session-pause'))
    await waitFor(() => expect(tid('session-pause')).toHaveTextContent(/^Pause$/))
    const row = (await d.designSessions.get(id))!
    expect(row.pausedMs).toBe(5 * MIN)
    expect(row.pausedAt).toBeUndefined()
    expect(screen.queryByTestId('session-paused')).toBeNull()
    expect(tid('session-phase')).toHaveTextContent(/^Drawing$/)
  })
  it('a session opened while paused (a reload) is still paused and its notes are read-only', async () => {
    await open('ai-partner', { ageMin: 10, paused: true })
    expect(tid('session-paused')).toBeVisible()
    expect(tid('session-phase')).toHaveTextContent(/^Paused$/)
    expect(tid('session-chat-input')).toHaveAttribute('readonly')
    expect(tid('session-send')).toBeDisabled()
  })
  it('CLOSE · DESIGN works while paused: the lock folds the pause away and minutes count drawing time only', async () => {
    const { d, id, advance } = await open('solo', { ageMin: 10, paused: true })
    advance(20 * MIN)
    fireEvent.click(tid('session-close-design'))
    await waitFor(() => expect(tid('session-phase')).toHaveTextContent(/^Close$/))
    await waitFor(async () => expect((await d.designSessions.get(id))!.phase).toBe('close'))
    const row = (await d.designSessions.get(id))!
    expect(row.minutes).toBe(10)
    expect(row.pausedMs).toBe(20 * MIN)
    expect(row.pausedAt).toBeUndefined()
    expect(row.lockedAt).toBe(T + 20 * MIN)
  })
  it('the footer reads what is graded, per mode', async () => {
    await open('human-partner', { ageMin: 1 })
    expect(tid('session-graded')).toHaveTextContent('Your partner scores the canvas and notes.')
  })
})

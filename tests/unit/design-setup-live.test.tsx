import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { startDesignSession } from '../../src/data/designSessionActions'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// DESIGN-81: ?new=1 on a design with a live session shows the setup with a note, Resume and Discard, and no Start.
const T = new Date('2026-10-11T10:00:00+05:30').getTime()
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
const tid = (id: string) => screen.getByTestId(id)

async function openSetupWithLive() {
  setNow(() => T)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 60_000 })
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method?new=1', path: '/designs/session/:designId' })
  await screen.findByTestId('session-setup')
  return { d, id: s.id }
}

describe('setup with a live session (DESIGN-81)', () => {
  it('shows the note with Resume and Discard, and no Start', async () => {
    await openSetupWithLive()
    const note = tid('session-live-note')
    expect(note).toHaveTextContent(/session is running on this design/i)
    expect(within(note).getByTestId('session-live-resume')).toBeInTheDocument()
    expect(within(note).getByTestId('session-live-discard')).toBeInTheDocument()
    expect(screen.queryByTestId('session-start')).toBeNull()
    // one accent: Resume may take it, Discard must not
    expect(document.querySelectorAll('[data-accent="primary"]').length).toBeLessThanOrEqual(1)
    expect(tid('session-live-discard')).not.toHaveAttribute('data-accent')
  })
  it('Resume opens the live session', async () => {
    const { id } = await openSetupWithLive()
    fireEvent.click(tid('session-live-resume'))
    await waitFor(() => expect(tid('session-phase')).toHaveAttribute('data-phase', 'drawing'))
    expect(screen.queryByTestId('session-setup')).toBeNull()
    expect(screen.queryByTestId('session-live-note')).toBeNull()
    expect((await screen.findAllByTestId('session-close-design')).length).toBe(1)
    expect(id).toBeTruthy()
  })
  it('Discard asks first; cancel keeps the note; confirm leaves the setup ready to start', async () => {
    const { d, id } = await openSetupWithLive()
    fireEvent.click(tid('session-live-discard'))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard this session?' })).getByTestId('session-discard-cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(tid('session-live-note')).toBeInTheDocument()
    expect(await d.designSessions.get(id)).toBeTruthy()
    fireEvent.click(tid('session-live-discard'))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Discard this session?' })).getByTestId('session-discard-confirm'))
    await waitFor(() => expect(screen.getByTestId('session-start')).toBeInTheDocument())
    expect(screen.queryByTestId('session-live-note')).toBeNull()
    expect(tid('session-phase')).toHaveAttribute('data-phase', 'setup')
    expect(await d.designSessions.get(id)).toBeUndefined()
    expect(tid('session-start')).toHaveAttribute('data-accent', 'primary')
  })
})

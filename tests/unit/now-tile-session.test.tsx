import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { Shell } from '../../src/app/Shell'
import type { DojoDB } from '../../src/data/db'
import { setNow } from '../../src/lib/clock'
import { loadStudy } from '../../src/lib/studyStore'
import { loadTimer } from '../../src/lib/timer'
import { beginStudy } from '../../src/study/runner'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'

// Ruling 24 S1 (cu-2 P2-1): Today's NOW tile shows a running study session (readout, Pause/Resume, End), never the idle
// Spar buttons, and Retreat/End ends the session itself.
const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const MON = ist('2026-09-07T21:10:00') // Monday: AI watch, the NOW card is m1w1t1
const MIN = 60_000
let clock = MON

const fx = () => ({ chime: vi.fn(), toast: vi.fn(), onError: vi.fn() })

async function todayWith(session: string | null) {
  clock = MON
  setNow(() => clock)
  const d: DojoDB = await seededDb()
  if (session) {
    const t = (await d.tickets.get(session))!
    expect(await beginStudy({ d, ticket: t, plan: { goal: 'g', focusMin: 25, breakMin: 5, cardIds: [session], chime: false }, nowMs: clock, ...fx() })).toBe(true)
  }
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/']}>
      <AppProviders db={d} plan={smallPlan}><Shell /></AppProviders>
    </MemoryRouter>,
  )
  await screen.findByTestId('now-headline')
  return d
}
const tile = () => screen.getByRole('region', { name: 'Now' })

describe('Today · NOW tile with a study session', () => {
  it('shows the session as the tile\'s running state: readout, Pause and End, no Spar buttons, no Retreat', async () => {
    await todayWith('m1w1t1')
    const t = within(tile())
    expect(await t.findByTestId('now-session')).toBeInTheDocument()
    expect(t.getByTestId('now-readout')).toHaveTextContent('25:00')
    expect(t.getByTestId('now-timer-sub')).toHaveTextContent('Focus · of 25 min · ends 21:35')
    expect(t.getByTestId('now-session-pause')).toHaveTextContent('Pause')
    expect(t.getByTestId('now-session-end')).toHaveTextContent('End session')
    expect(t.queryByTestId('spar-50')).toBeNull()
    expect(t.queryByTestId('spar-25')).toBeNull()
    expect(t.queryByRole('button', { name: /Retreat/ })).toBeNull()
    expect(t.getByTestId('start-button')).toHaveAttribute('href', '/do/m1w1t1')
  })

  it('stays the running state through the break (the Spar buttons never come back under a running session)', async () => {
    await todayWith('m1w1t1')
    await screen.findByTestId('now-session')
    clock += 25 * MIN
    await waitFor(() => expect(screen.getByTestId('now-timer-sub')).toHaveTextContent('Break · of 5 min · ends 21:40'), { timeout: 4000 })
    expect(screen.getByTestId('now-session')).toHaveAttribute('data-phase', 'break')
    expect(screen.getByTestId('now-readout')).toHaveTextContent(/^05:00$|^04:5\d$/)
    expect(screen.queryByTestId('spar-25')).toBeNull()
  })

  it('Pause holds the readout and reads Resume; Resume runs it on; the session and its timer follow', async () => {
    await todayWith('m1w1t1')
    fireEvent.click(await screen.findByTestId('now-session-pause'))
    expect(screen.getByTestId('now-readout')).toHaveAttribute('data-paused', 'true')
    expect(screen.getByTestId('now-timer-sub')).toHaveTextContent('Focus · paused')
    expect(loadStudy()!.paused).not.toBeNull()
    expect(loadTimer()).toMatchObject({ running: false })
    fireEvent.click(screen.getByTestId('now-session-resume'))
    expect(screen.getByTestId('now-readout')).not.toHaveAttribute('data-paused')
    expect(loadStudy()!.paused).toBeNull()
    expect(loadTimer()).toMatchObject({ running: true })
  })

  it('the space key pauses and resumes the session itself, not a timer under it', async () => {
    await todayWith('m1w1t1')
    await screen.findByTestId('now-session')
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(loadStudy()!.paused).not.toBeNull()
    expect(screen.getByTestId('now-readout')).toHaveAttribute('data-paused', 'true')
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(loadStudy()!.paused).toBeNull()
    expect(screen.getByTestId('now-readout')).not.toHaveAttribute('data-paused')
  })

  it('End opens the End session dialog; Keep going leaves the session running', async () => {
    await todayWith('m1w1t1')
    fireEvent.click(await screen.findByTestId('now-session-end'))
    const dlg = await screen.findByRole('dialog', { name: 'End session' })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Keep going' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'End session' })).toBeNull())
    expect(loadStudy()).not.toBeNull()
    expect(screen.getByTestId('now-session')).toBeInTheDocument()
  })

  it('End ends the session itself: one studied row, no session, no timer, the tile and the pill are idle again', async () => {
    const d = await todayWith('m1w1t1')
    expect(await screen.findByTestId('session-pill')).toBeInTheDocument()
    fireEvent.click(await screen.findByTestId('now-session-end'))
    const dlg = await screen.findByRole('dialog', { name: 'End session' })
    fireEvent.change(within(dlg).getByLabelText('Done'), { target: { value: 'the loop' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(loadStudy()).toBeNull())
    expect(loadTimer()).toBeNull()
    const rows = await d.sessions.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ticketId: 'm1w1t1', outcome: 'studied', endLog: { done: 'the loop' } })
    await waitFor(() => expect(screen.queryByTestId('now-session')).toBeNull())
    expect(screen.getByTestId('spar-25')).toBeInTheDocument()
    expect(screen.queryByTestId('now-readout')).toBeNull() // no stale Spar readout left from the session's block timer
    expect(screen.queryByTestId('session-pill')).toBeNull()
  })

  it('a session on another card shows in the tile too, naming its card, and Spar is not offered under it', async () => {
    const d = await todayWith('p127')
    const other = (await d.tickets.get('p127'))!
    const t = within(tile())
    expect(await t.findByTestId('now-session')).toBeInTheDocument()
    expect(t.getByTestId('now-timer-sub')).toHaveTextContent(`${other.title} · Focus · of 25 min`)
    expect(t.queryByTestId('spar-25')).toBeNull()
    expect(t.getByTestId('start-button')).toHaveAttribute('href', '/do/m1w1t1')
  })

  it('with no session the tile is the idle Spar tile, and a plain Spar timer still has its Retreat', async () => {
    await todayWith(null)
    const t = within(tile())
    expect(t.queryByTestId('now-session')).toBeNull()
    expect(t.getByTestId('spar-25')).toBeInTheDocument()
    fireEvent.click(t.getByTestId('spar-25'))
    expect(await t.findByRole('button', { name: 'Retreat: stop the timer' })).toHaveAttribute('data-tip', 'Stop the timer')
    expect(t.queryByTestId('now-session')).toBeNull()
  })
})

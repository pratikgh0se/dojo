import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as chimeLib from '../../src/lib/chime'
import { setNow } from '../../src/lib/clock'
import { saveTimer, TIMER_KEY } from '../../src/lib/timer'
import { useSparTimer } from '../../src/ui/useSparTimer'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()

function Probe({ id }: { id: string | null }) {
  const s = useSparTimer(id)
  return (
    <div>
      <span data-testid="run">{String(s.running)}</span>
      <span data-testid="mmss">{s.mmss}</span>
      <span data-testid="blocks">{s.blocks.join(',')}</span>
      <span data-testid="ends">{s.endsAt}</span>
      <button onClick={() => s.start(25)}>go</button>
      <button onClick={s.retreat}>stop</button>
    </div>
  )
}

async function mount(id: string | null) {
  const db = await seededDb()
  renderWithApp(<Probe id={id} />, { db, plan: smallPlan })
  return db
}
const stored = () => JSON.parse(localStorage.getItem(TIMER_KEY) ?? 'null')

describe('useSparTimer', () => {
  it('starts a 25-min timer for the lead ticket and retreats', async () => {
    setNow(() => ist('2026-10-05T21:10:00'))
    await mount('m1w1t1')
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    // start() now awaits startDoing (N3) before starting the timer, so the state update lands
    // a tick after the click.
    await waitFor(() => expect(screen.getByTestId('run')).toHaveTextContent('true'))
    expect(screen.getByTestId('mmss')).toHaveTextContent('25:00')
    expect(screen.getByTestId('blocks')).toHaveTextContent('draining,full,full,full,full')
    expect(screen.getByTestId('ends')).toHaveTextContent('21:35')
    expect(stored()).toMatchObject({ ticketId: 'm1w1t1', min: 25, running: true })
    fireEvent.click(screen.getByRole('button', { name: 'stop' }))
    expect(screen.getByTestId('run')).toHaveTextContent('false')
    // Retreat clears the timer entirely (I1): a merely-stopped timer would keep its
    // sessionStart for this ticket, and lib/timer.ts's startTimer reuses it on the next Start,
    // inflating/misdating whatever session comes next — even a Do finish on a later day.
    expect(stored()).toBeNull()
  })

  it('Spar start also moves the ticket to Doing, like the Do screen\'s Start (I1)', async () => {
    setNow(() => ist('2026-10-05T21:10:00'))
    const d = await mount('m1w1t1')
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    await waitFor(async () => expect((await d.tickets.get('m1w1t1'))!.status).toBe('doing'))
  })

  it('shows a timer already running on another ticket and refuses to overwrite it (Review Focus #4)', async () => {
    localStorage.setItem(TIMER_KEY, JSON.stringify({
      ticketId: 'p200', sessionStart: ist('2026-10-05T21:00:00'), start: ist('2026-10-05T21:00:00'),
      end: ist('2026-10-05T21:25:00'), min: 25, running: true, notified: false,
    }))
    setNow(() => ist('2026-10-05T21:10:00'))
    await mount('m1w1t1')
    expect(screen.getByTestId('mmss')).toHaveTextContent('15:00')
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    expect(stored()).toMatchObject({ ticketId: 'p200' })
    expect(await screen.findByText('A timer is already running on another ticket — Retreat first')).toBeInTheDocument()
  })

  it('on expiry: stops, flashes, powers Pom up and toasts "Power up · N min" once', async () => {
    delete document.documentElement.dataset.powerups
    delete document.documentElement.dataset.flashes
    localStorage.setItem(TIMER_KEY, JSON.stringify({
      ticketId: 'm1w1t1', sessionStart: ist('2026-10-05T21:00:00'), start: ist('2026-10-05T21:00:00'),
      end: ist('2026-10-05T21:25:00'), min: 25, running: true, notified: false,
    }))
    setNow(() => ist('2026-10-05T21:26:00'))
    await mount('m1w1t1')
    expect(await screen.findByText('Power up · 25 min')).toBeInTheDocument()
    // Stopped, not cleared (N2): sessionStart stays so a same-day Do finish on this ticket can
    // pick up the Spar minutes. Retreat (tested above) still clears it fully.
    expect(stored()).toMatchObject({ ticketId: 'm1w1t1', running: false, notified: true, sessionStart: ist('2026-10-05T21:00:00') })
    expect(document.documentElement.dataset.flashes).toBe('1')
    expect(document.documentElement.dataset.powerups).toBe('1')
    expect(screen.getByTestId('run')).toHaveTextContent('false')
  })

  it('does not start the timer when startDoing fails, and shows the same error path as Do (N3)', async () => {
    setNow(() => ist('2026-10-05T21:10:00'))
    const d = await mount('m1w1t1')
    await d.tickets.bulkUpdate([
      { key: 'p127', changes: { status: 'doing' } },
      { key: 'p200', changes: { status: 'doing' } },
      { key: 'm1w2t1', changes: { status: 'doing', sprint: 1 } }, // the limit is per sprint (ruling 25 R2): all three in Sprint 1
    ])
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    expect(await screen.findByText(/Doing is full \(3\/3\)/)).toBeInTheDocument()
    expect(stored()).toBeNull()
    expect(screen.getByTestId('run')).toHaveTextContent('false')
  })

  it('does nothing without a lead ticket', async () => {
    setNow(() => ist('2026-10-09T21:10:00'))
    await mount(null)
    fireEvent.click(screen.getByRole('button', { name: 'go' }))
    expect(stored()).toBeNull()
  })

  it('a Spar run that reaches 00:00 chimes once, unless the soft chime is off (cu-2 P3-6)', async () => {
    const T = ist('2026-10-05T21:10:00')
    const MIN = 60_000
    saveTimer({ ticketId: 'm1w1t1', sessionStart: T, start: T, end: T + MIN, min: 1, running: true, notified: false })
    setNow(() => T + 2 * MIN)
    const chime = vi.spyOn(chimeLib, 'playChime').mockReturnValue(true)
    await mount('m1w1t1')
    await waitFor(() => expect(stored()).toMatchObject({ running: false, notified: true }))
    expect(chime).toHaveBeenCalledTimes(1)
    chime.mockClear()
    localStorage.setItem('dojo-study-chime', 'false')
    saveTimer({ ticketId: 'm1w1t1', sessionStart: T, start: T, end: T + MIN, min: 1, running: true, notified: false })
    await mount('m1w1t1')
    await waitFor(() => expect(stored()).toMatchObject({ running: false, notified: true }))
    expect(chime).not.toHaveBeenCalled()
    chime.mockRestore()
  })
})

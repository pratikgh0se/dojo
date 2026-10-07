import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { draftBrief } from '../../src/data/briefActions'
import { recordRung } from '../../src/data/ladderActions'
import { setNow } from '../../src/lib/clock'
import { Do } from '../../src/screens/Do'
import { CheckGate } from '../../src/screens/brief/CheckGate'
import { TIMER_KEY } from '../../src/lib/timer'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

// Ruling 23 K1 (UAT cu-1 P2-3): on Do, space toggles the timer, d marks the card done (a learning card opens its check),
// s slides it to the next sprint, Esc leaves.
const T = new Date('2026-09-08T21:10:00+05:30').getTime()
const stored = () => JSON.parse(localStorage.getItem(TIMER_KEY) ?? 'null')
afterEach(() => localStorage.clear())

async function open(id: string, withCheck = false) {
  setNow(() => T)
  const d = await seededDb()
  if (withCheck) {
    await d.tickets.put(mkTicket({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps', sprint: 1, order: -1 }))
    await draftBrief(d, 'w1', T)
  }
  renderWithApp(<><Do /><CheckGate /></>, { db: d, plan: smallPlan, route: `/do/${id}`, path: '/do/:ticketId' })
  await screen.findByTestId('do-screen')
  await act(async () => { await new Promise(r => setTimeout(r, 50)) }) // the screen's passive effects (its key listener) and the settings row have run
  return d
}

describe('Do keys', () => {
  it('space starts, pauses and resumes the timer', async () => {
    await open('p127')
    expect(fireEvent.keyDown(document.body, { key: ' ' })).toBe(false)
    await waitFor(() => expect(stored()).toMatchObject({ ticketId: 'p127', running: true }))
    fireEvent.keyDown(document.body, { key: ' ' })
    await waitFor(() => expect(stored()).toMatchObject({ running: false }))
    expect(stored().pausedRemaining).toBeGreaterThan(0)
    fireEvent.keyDown(document.body, { key: ' ' })
    await waitFor(() => expect(stored()).toMatchObject({ running: true }))
  })

  it('d marks the card done (Solved ✓) and goes back to the Board', async () => {
    const d = await open('p127')
    fireEvent.keyDown(document.body, { key: 'd' })
    await waitFor(async () => expect((await d.tickets.get('p127'))!.status).toBe('done'))
    expect((await d.sessions.toArray())[0]).toMatchObject({ ticketId: 'p127', outcome: 'solved' })
  })

  it('d after help was used marks it "solved with help", the one outcome that is enabled', async () => {
    const d = await open('p127')
    expect(await screen.findByTestId('do-outcome-help')).toBeEnabled()
    // a used help rung is what disables Solved ✓ (the ladder's own tests cover opening one)
    const cycleKey = Object.keys(localStorage).find(k => k.startsWith('dojo-cycle:p127'))!
    const cycle = JSON.parse(localStorage.getItem(cycleKey)!)
    await recordRung(d, { ticketId: 'p127', attemptStart: cycle.attemptStart, cycleId: cycle.id, rung: 2, cost: 0, at: T, level: 1 })
    await waitFor(() => expect(screen.getByTestId('do-outcome-solved')).toBeDisabled())
    fireEvent.keyDown(document.body, { key: 'd' })
    await waitFor(async () => expect((await d.tickets.get('p127'))!.status).toBe('done'))
    expect((await d.sessions.toArray())[0]).toMatchObject({ outcome: 'solved_help' })
  })

  it('s slides the card to the next sprint and says so', async () => {
    const d = await open('p127')
    fireEvent.keyDown(document.body, { key: 's' })
    await waitFor(async () => expect((await d.tickets.get('p127'))!.sprint).toBe(2))
    expect(await screen.findByText(/^Slid .+ to Sprint 2$/)).toBeInTheDocument()
  })

  it('d on a learning card opens its check instead of ticking it', async () => {
    const d = await open('w1', true)
    fireEvent.keyDown(document.body, { key: 'd' })
    expect(await screen.findByRole('dialog', { name: 'Check your understanding' })).toBeInTheDocument()
    expect((await d.tickets.get('w1'))!.status).not.toBe('done')
  })

  it('d and s ignore typing in a field, a modifier and a held key', async () => {
    const d = await open('p127')
    const field = await screen.findByLabelText('What is the invariant? What did you try?')
    fireEvent.keyDown(field, { key: 'd' })
    fireEvent.keyDown(field, { key: 's' })
    fireEvent.keyDown(document.body, { key: 'd', metaKey: true })
    fireEvent.keyDown(document.body, { key: 's', repeat: true })
    await new Promise(r => setTimeout(r, 50))
    expect((await d.tickets.get('p127'))!).toMatchObject({ status: 'todo', sprint: 1 })
  })
})

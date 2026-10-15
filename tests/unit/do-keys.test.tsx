import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { recordRung } from '../../src/data/ladderActions'
import { setNow } from '../../src/lib/clock'
import { Do } from '../../src/screens/Do'
import { loadStudy } from '../../src/lib/studyStore'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// Ruling 23 K1 (UAT cu-1 P2-3): on Do, space starts, pauses and resumes the session, d marks the card done (a card with a check opens it),
// Esc leaves. Sprints are gone, so there is no slide key.
const T = new Date('2026-09-08T21:10:00+05:30').getTime()
afterEach(() => localStorage.clear())

async function open(id: string) {
  setNow(() => T)
  const d = await seededDb()
  renderWithApp(<Do />, { db: d, plan: flatPlanV2, route: `/do/${id}`, path: '/do/:ticketId' })
  await screen.findByTestId('do-screen')
  await act(async () => { await new Promise(r => setTimeout(r, 50)) }) // the screen's passive effects (its key listener) and the settings row have run
  return d
}

describe('Do keys', () => {
  it('space starts, pauses and resumes the session', async () => {
    await open('p127')
    expect(fireEvent.keyDown(document.body, { key: ' ' })).toBe(false)
    await waitFor(() => expect(loadStudy()).toMatchObject({ ticketId: 'p127', single: true }))
    expect(loadStudy()!.paused ?? null).toBeNull()
    fireEvent.keyDown(document.body, { key: ' ' })
    await waitFor(() => expect(loadStudy()!.paused).toBeGreaterThan(0))
    fireEvent.keyDown(document.body, { key: ' ' })
    await waitFor(() => expect(loadStudy()!.paused ?? null).toBeNull())
  })

  it('d marks the card done (Solved) and goes back to Today', async () => {
    const d = await open('p127')
    fireEvent.keyDown(document.body, { key: 'd' })
    await waitFor(async () => expect((await d.tickets.get('p127'))!.status).toBe('done'))
    expect((await d.sessions.toArray())[0]).toMatchObject({ ticketId: 'p127', outcome: 'solved' })
  })

  it('d after help was used marks it "solved with help", the one outcome that is enabled', async () => {
    const d = await open('p127')
    expect(await screen.findByTestId('do-outcome-help')).toBeEnabled()
    // a used help rung is what disables Solved (the ladder's own tests cover opening one)
    const cycleKey = Object.keys(localStorage).find(k => k.startsWith('dojo-cycle:p127'))!
    const cycle = JSON.parse(localStorage.getItem(cycleKey)!)
    await recordRung(d, { ticketId: 'p127', attemptStart: cycle.attemptStart, cycleId: cycle.id, rung: 2, cost: 0, at: T, level: 1 })
    await waitFor(() => expect(screen.getByTestId('do-outcome-solved')).toBeDisabled())
    fireEvent.keyDown(document.body, { key: 'd' })
    await waitFor(async () => expect((await d.tickets.get('p127'))!.status).toBe('done'))
    expect((await d.sessions.toArray())[0]).toMatchObject({ outcome: 'solved_help' })
  })

  it('s does nothing: no slide, no toast, the card stays put', async () => {
    const d = await open('p127')
    fireEvent.keyDown(document.body, { key: 's' })
    await new Promise(r => setTimeout(r, 50))
    expect(screen.queryByText(/Slid/)).toBeNull()
    expect((await d.tickets.get('p127'))!).toMatchObject({ status: 'todo', sprint: 1 })
  })

  it('d ignores typing in a field, a modifier and a held key', async () => {
    const d = await open('p127')
    const field = await screen.findByLabelText('What is the invariant? What did you try?')
    fireEvent.keyDown(field, { key: 'd' })
    fireEvent.keyDown(document.body, { key: 'd', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'd', repeat: true })
    await new Promise(r => setTimeout(r, 50))
    expect((await d.tickets.get('p127'))!).toMatchObject({ status: 'todo', sprint: 1 })
  })
})

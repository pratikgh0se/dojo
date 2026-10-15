import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { seedBrief } from '../helpers/briefs'
import { moveTicket } from '../../src/data/boardActions'
import { closeLadderSession } from '../../src/data/ladderActions'
import { setNow } from '../../src/lib/clock'
import { CheckGate } from '../../src/screens/brief/CheckGate'
import { OPEN_CHECK_EVENT } from '../../src/lib/checkGate'
import { needsCheck } from '../../src/rules/brief'
import { freshDb, seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()
const NOW = at(2026, 9, 8) // sprint 1 of a plan starting 2026-09-07
afterEach(() => localStorage.clear())

async function withLearningCard() {
  setNow(() => NOW)
  const d = await seededDb()
  await d.tickets.put(mkTicket({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps', sprint: 1, order: -1 }))
  await seedBrief(d, 'w1')
  return d
}

describe('the check cannot be bypassed (briefs Addendum 3)', () => {
  it('needsCheck: a briefed, unfinished learning card with questions', async () => {
    const d = await withLearningCard()
    expect(needsCheck((await d.tickets.get('w1'))!)).toBe(true)
    expect(needsCheck((await d.tickets.get('p1'))!)).toBe(false)
    expect(needsCheck({ ...(await d.tickets.get('w1'))!, status: 'done' })).toBe(false)
  })

  it('moveTicket to Done refuses with check_required and changes nothing; other cards are unchanged', async () => {
    const d = await withLearningCard()
    expect(await moveTicket(d, 'w1', 'done', NOW)).toEqual({ ok: false, reason: 'check_required', message: 'Check your understanding first' })
    expect((await d.tickets.get('w1'))!).toMatchObject({ status: 'todo', xp: 0 })
    expect(await d.events.count()).toBe(0)
    expect(await moveTicket(d, 'p1', 'done', NOW)).toMatchObject({ ok: true })
    expect(await moveTicket(d, 'w1', 'doing', NOW)).toMatchObject({ ok: true })
  })

  it('an unbriefed learning card ticks as before', async () => {
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'w2', kind: 'watch' }))
    expect(await moveTicket(d, 'w2', 'done', NOW)).toMatchObject({ ok: true })
  })

  it('closing a Do session as Solved or Solved with help is refused for such a card; Give up is not', async () => {
    const d = await withLearningCard()
    for (const outcome of ['solved', 'solved_help'] as const) {
      const r = await closeLadderSession(d, { ticketId: 'w1', outcome, attemptStart: NOW, cycleId: 'c', sessionStart: NOW, now: NOW, netAtStart: 0, redoId: null })
      expect(r).toMatchObject({ ok: false, reason: 'check_required' })
    }
    expect((await d.tickets.get('w1'))!.status).toBe('todo')
    expect(await d.sessions.count()).toBe(0)
    expect(await closeLadderSession(d, { ticketId: 'w1', outcome: 'gave_up', attemptStart: NOW, cycleId: 'c', sessionStart: NOW, now: NOW, netAtStart: 0, redoId: null })).toMatchObject({ ok: true })
  })

  it('passing the check is still the way to finish the card', async () => {
    const d = await withLearningCard()
    renderWithApp(<CheckGate />, { db: d, plan: flatPlanV2 })
    window.dispatchEvent(new CustomEvent(OPEN_CHECK_EVENT, { detail: 'w1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Check your understanding' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'about hash maps' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Hash maps' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check answers' }))
    expect(await within(dialog).findByText('Passed', {}, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(async () => expect((await d.tickets.get('w1'))!).toMatchObject({ status: 'done', xp: 10 }))
  })
})

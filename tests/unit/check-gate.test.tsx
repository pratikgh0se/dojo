import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { draftBrief } from '../../src/data/briefActions'
import { moveTicket } from '../../src/data/boardActions'
import { closeLadderSession } from '../../src/data/ladderActions'
import { patchSettings } from '../../src/data/db'
import { buildReview, sprintsNeedingReview } from '../../src/data/reviewActions'
import { FAKE_FAIL_KEY } from '../../src/ai/fake'
import { setNow } from '../../src/lib/clock'
import { CheckGate } from '../../src/screens/brief/CheckGate'
import { Board } from '../../src/screens/Board'
import { Today } from '../../src/screens/Today'
import { needsCheck } from '../../src/rules/brief'
import { freshDb, seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()
const NOW = at(2026, 9, 8) // sprint 1 of a plan starting 2026-09-07
afterEach(() => localStorage.clear())

async function withLearningCard() {
  setNow(() => NOW)
  const d = await seededDb()
  await d.tickets.put(mkTicket({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps', sprint: 1, order: -1 }))
  await draftBrief(d, 'w1', NOW)
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

  it('the Board Done button opens Check your understanding instead of ticking', async () => {
    const d = await withLearningCard()
    renderWithApp(<><Board /><CheckGate /></>, { db: d, plan: smallPlan, route: '/board', path: '/board' })
    const card = await screen.findByTestId('card-w1')
    fireEvent.click(within(card).getByRole('button', { name: 'Done ✓' }))
    expect(await screen.findByRole('dialog', { name: 'Check your understanding' })).toBeInTheDocument()
    expect((await d.tickets.get('w1'))!.status).toBe('todo')
  })

  it('the d key and a drag to Done on the Board open the check too', async () => {
    const d = await withLearningCard()
    renderWithApp(<><Board /><CheckGate /></>, { db: d, plan: smallPlan, route: '/board', path: '/board' })
    const card = await screen.findByTestId('card-w1')
    card.focus()
    fireEvent.keyDown(card, { key: 'd' })
    const dialog = await screen.findByRole('dialog', { name: 'Check your understanding' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.dragStart(screen.getByTestId('card-w1'))
    fireEvent.drop(screen.getByTestId('col-done'))
    expect(await screen.findByRole('dialog', { name: 'Check your understanding' })).toBeInTheDocument()
    expect((await d.tickets.get('w1'))!.status).toBe('todo')
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

  it('the Today Done: checkbox opens the check, and stays unticked', async () => {
    const d = await withLearningCard()
    await d.tickets.update('w1', { text: 'Hash maps', track: 'ai', kind: 'watch' })
    renderWithApp(<><Today /><CheckGate /></>, { db: d, plan: smallPlan })
    fireEvent.click(await screen.findByRole('button', { name: /This sprint/ }))
    const box = await screen.findByRole('checkbox', { name: 'Done: Hash maps' })
    fireEvent.click(box)
    expect(await screen.findByRole('dialog', { name: 'Check your understanding' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Done: Hash maps' })).toHaveAttribute('aria-checked', 'false'))
    expect((await d.tickets.get('w1'))!.status).toBe('todo')
  })

  it('passing the check is still the way to finish the card', async () => {
    const d = await withLearningCard()
    renderWithApp(<><Board /><CheckGate /></>, { db: d, plan: smallPlan, route: '/board', path: '/board' })
    fireEvent.click(within(await screen.findByTestId('card-w1')).getByRole('button', { name: 'Done ✓' }))
    const dialog = await screen.findByRole('dialog', { name: 'Check your understanding' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'about hash maps' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Hash maps' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check answers' }))
    expect(await within(dialog).findByText('Passed', {}, { timeout: 5000 })).toBeInTheDocument()
    await waitFor(async () => expect((await d.tickets.get('w1'))!).toMatchObject({ status: 'done', xp: 10 }))
  })
})

describe('automatic sprint-end review (briefs Addendum 3)', () => {
  async function plan() {
    const d = freshDb()
    await patchSettings(d, { startDate: '2026-10-05', trackedFrom: 1 })
    await d.tickets.bulkPut([mkTicket({ id: 'a', sprint: 1, status: 'done' }), mkTicket({ id: 'b', sprint: 1 })])
    return d
  }
  it('lists every ended sprint without an auto review, newest first, at most 3 per open; none during sprint 1 or before tracking', async () => {
    const d = await plan()
    expect(await sprintsNeedingReview(d, at(2026, 10, 10))).toEqual([])
    expect(await sprintsNeedingReview(d, at(2026, 10, 20))).toEqual([1])
    expect(await sprintsNeedingReview(d, at(2026, 11, 3))).toEqual([2, 1])
    expect(await sprintsNeedingReview(d, at(2027, 1, 20))).toEqual([7, 6, 5])
    expect(await sprintsNeedingReview(d, at(2027, 1, 20), new Set([7, 6]))).toEqual([5, 4, 3]) // attempted sprints are dropped before the cut
    await patchSettings(d, { trackedFrom: 3 })
    expect(await sprintsNeedingReview(d, at(2026, 11, 3))).toEqual([])
    await patchSettings(d, { trackedFrom: 1 })
    await buildReview(d, 1, at(2026, 10, 20), true)
    expect(await sprintsNeedingReview(d, at(2026, 10, 20))).toEqual([])
    expect(await sprintsNeedingReview(d, at(2026, 11, 3))).toEqual([2])
  })
  it('a manual review, even one built mid-sprint, does not stand in for the automatic one', async () => {
    const d = await plan()
    await buildReview(d, 1, at(2026, 10, 10)) // Build review during sprint 1
    expect((await d.reviews.toArray())[0].kind).toBe('manual')
    expect(await sprintsNeedingReview(d, at(2026, 10, 20))).toEqual([1])
    await buildReview(d, 1, at(2026, 10, 20), true)
    expect((await d.reviews.toArray()).map(r => r.kind).sort()).toEqual(['auto', 'manual'])
  })
  it('two concurrent automatic runs for one sprint store a single auto review', async () => {
    const d = await plan()
    const [a, b] = await Promise.all([buildReview(d, 1, at(2026, 10, 20), true), buildReview(d, 1, at(2026, 10, 20), true)])
    expect(a.ok && b.ok).toBe(true)
    expect((await d.reviews.toArray()).filter(r => r.kind === 'auto')).toHaveLength(1)
    if (a.ok && b.ok) expect(a.review.id === b.review.id || (await d.reviews.count()) === 1).toBe(true)
  })
  it('builds numbers and fake prose, marked auto', async () => {
    const d = await plan()
    const r = await buildReview(d, 1, at(2026, 10, 20), true)
    expect(r.ok && r.review).toMatchObject({ sprint: 1, kind: 'auto', prose: 'Review for Sprint 1: 1/2 cards done.', stats: { planned: 2, done: 1 } })
  })
  it('keeps the numbers when the prose job fails', async () => {
    const d = await plan()
    localStorage.setItem(FAKE_FAIL_KEY, 'review_sprint')
    const r = await buildReview(d, 1, at(2026, 10, 20), true)
    expect(r.ok && r.review).toMatchObject({ prose: '', kind: 'auto', stats: { planned: 2, done: 1 } })
    expect(await d.reviews.count()).toBe(1)
  })
})

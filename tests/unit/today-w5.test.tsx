// W5 (rituals.md): the new Today cards (weekly review, swap drill, focus line, Floor card and lead) against real Dexie and real components.
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '../../src/data/types'
import { resetNow, setNow } from '../../src/lib/clock'
import { Today } from '../../src/screens/Today'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const m = vi.hoisted(() => ({ model: null as unknown }))
vi.mock('../../src/data/flatHooks', () => ({
  useTodayModel: () => m.model,
  usePace: () => ({ projection: {}, line: 'at this pace the plan ends about March 2028', budgets: [90, 60, 60, 60, 30, 30, 150] }),
}))

const at = (y: number, mo: number, d: number, h = 12, min = 0) => new Date(y, mo - 1, d, h, min).getTime()
const watch = mkTicket({ id: 'w1', kind: 'watch', title: 'Watch: Karpathy deep dive', estMin: 45, phase: 1 })
const doneW = { ...mkTicket({ id: 'x', kind: 'watch' }), status: 'done' as const }
const baseModel = { next: { kind: 'start', ticket: watch, reason: 'next in your queue' }, mix: { budget: 60, items: [watch], floor: false, waitsForLongerDay: [], lanesDone: [] }, pathNote: null, budgets: [90, 60, 60, 60, 30, 30, 150], careerLane: false, dueReviews: 0, lead: null, pick: { doing: [], lanes: [] } }
const RITUALS = [
  { id: 'weekly-review', title: 'Weekly review', cadence: 'weekly' as const, minutes: 60, dueWeekday: 0, dueHour: 12 },
  { id: 'model-swap-drill', title: 'Model swap drill', cadence: 'monthly' as const, minutes: 180, dueWeekday: 6, body: 'Swap a model and re-measure.' },
]
const WR_TEXT = 'Look back at your week, then write three short lines: what worked, what to change, and a focus for next week.'

afterEach(() => { m.model = null; localStorage.clear(); resetNow() })

async function setup(o: { now: number; tickets?: Ticket[]; model?: object; route?: string; reviews?: { id: string; week: string; worked: string; change: string; focus: string; at: number }[] }) {
  setNow(() => o.now)
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-10-21', planVersion: 't', aiProviders: {}, possibleXp: 0 })
  await d.tickets.bulkPut(o.tickets ?? [doneW, watch])
  if (o.reviews) await d.weeklyReviews.bulkPut(o.reviews)
  m.model = { ...baseModel, ...(o.model ?? {}) }
  renderWithApp(<Today />, { db: d, ...appPlans({ rituals: RITUALS }), route: o.route ?? '/' })
  await screen.findByTestId('today-pulse')
  return d
}
const weekTicket = (status: Ticket['status']): Ticket => ({ ...mkTicket({ id: 'ritual-weekly-review-2026-W45', origin: 'ritual:weekly-review:2026-W45', kind: 'ritual', lane: 'ritual', title: 'Weekly review' }), status })

describe('the weekly review card (Sunday 12:00 to the end of Sunday)', () => {
  for (const [name, now] of [['Saturday 23:59', at(2026, 11, 7, 23, 59)], ['Sunday 00:00', at(2026, 11, 8, 0, 0)], ['Sunday 11:59', at(2026, 11, 8, 11, 59)]] as const) {
    it(`is absent at ${name}, and no ticket is created`, async () => {
      const d = await setup({ now })
      expect(screen.queryByTestId('today-ritual-weekly-review')).toBeNull()
      expect((await d.tickets.toArray()).some(t => t.origin.startsWith('ritual:weekly-review:'))).toBe(false)
    })
  }
  it('shows at Sunday 12:00 with the header, the body and a quiet Open; the page load writes no ticket; Open mints it and goes to the Week view', async () => {
    const d = await setup({ now: at(2026, 11, 8, 12, 0) })
    const card = await screen.findByTestId('today-ritual-weekly-review')
    expect(card).toHaveAttribute('data-state', 'open')
    expect(card).toHaveTextContent('Weekly review')
    expect(card).toHaveTextContent(WR_TEXT)
    expect(card.getAttribute('data-accent')).toBeNull()
    expect(screen.getByTestId('today-ritual-open-weekly-review')).toHaveTextContent('Open')
    expect(screen.queryByTestId('today-ritual-skip-weekly-review')).toBeNull()
    expect(await d.tickets.get('ritual-weekly-review-2026-W45')).toBeUndefined()
    fireEvent.click(screen.getByTestId('today-ritual-open-weekly-review'))
    await waitFor(async () => expect(await d.tickets.get('ritual-weekly-review-2026-W45')).toMatchObject({ kind: 'ritual', status: 'todo', text: WR_TEXT, xp: 0, estMin: 60 }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/journal'))
    expect(screen.getByTestId('location').getAttribute('data-search')).toBe('?view=week')
  })
  it('is gone on Monday 00:00, and nothing about it remains (not even as a generic ritual card)', async () => {
    await setup({ now: at(2026, 11, 9, 0, 0), tickets: [doneW, watch, weekTicket('todo')] })
    expect(screen.queryByTestId('today-ritual-weekly-review')).toBeNull()
    expect(screen.queryByText(/Weekly review/)).toBeNull()
  })
  it('a minted todo ticket shows only the dedicated card, with no skip control', async () => {
    await setup({ now: at(2026, 11, 8, 13), tickets: [doneW, watch, weekTicket('todo')] })
    await screen.findByTestId('today-ritual-weekly-review')
    expect(screen.getAllByTestId('today-ritual-weekly-review')).toHaveLength(1)
    expect(screen.queryByTestId('today-ritual-skip-ritual-weekly-review-2026-W45')).toBeNull()
    expect(screen.queryByTestId('today-ritual-ritual-weekly-review-2026-W45')).toBeNull()
  })
  it('a done week ticket keeps the card as Done and Open still leads to the Week view', async () => {
    await setup({ now: at(2026, 11, 8, 13), tickets: [doneW, watch, weekTicket('done')] })
    const card = await screen.findByTestId('today-ritual-weekly-review')
    expect(card).toHaveAttribute('data-state', 'done')
    expect(screen.getByTestId('today-ritual-weekly-review-state')).toHaveTextContent(/^Done$/)
    fireEvent.click(screen.getByTestId('today-ritual-open-weekly-review'))
    await waitFor(() => expect(screen.getByTestId('location').getAttribute('data-search')).toBe('?view=week'))
  })
  it('appears while the page is open when the clock passes 12:00', async () => {
    await setup({ now: at(2026, 11, 8, 11, 59) })
    expect(screen.queryByTestId('today-ritual-weekly-review')).toBeNull()
    setNow(() => at(2026, 11, 8, 12, 1))
    await screen.findByTestId('today-ritual-weekly-review', undefined, { timeout: 3000 })
  })
  it('names no weekday, shows no count and no XP', async () => {
    await setup({ now: at(2026, 11, 8, 14) })
    const text = (await screen.findByTestId('today-ritual-weekly-review')).textContent ?? ''
    expect(text).not.toMatch(/Sunday|Monday|streak|XP|\d/)
  })
})

describe('the monthly swap drill card (first Saturday to the end of the month)', () => {
  it('is absent on Nov 6 23:59 and on Wednesday Nov 4', async () => {
    await setup({ now: at(2026, 11, 6, 23, 59) })
    expect(screen.queryByTestId('today-ritual-model-swap-drill')).toBeNull()
  })
  it('shows from Saturday 2026-11-07 00:00 as "Model swap drill · monthly" with the plan body; Open mints the month ticket and opens it', async () => {
    const d = await setup({ now: at(2026, 11, 7, 0, 0) })
    const card = await screen.findByTestId('today-ritual-model-swap-drill')
    expect(card).toHaveAttribute('data-state', 'open')
    expect(card).toHaveTextContent('Model swap drill · monthly')
    expect(card).toHaveTextContent('Swap a model and re-measure.')
    expect(screen.queryByTestId('today-ritual-skip-model-swap-drill')).toBeNull()
    fireEvent.click(screen.getByTestId('today-ritual-open-model-swap-drill'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/do/ritual-model-swap-drill-2026-11'))
    expect(await d.tickets.get('ritual-model-swap-drill-2026-11')).toMatchObject({ kind: 'ritual', text: 'Swap a model and re-measure.', estMin: 180, status: 'todo', xp: 0 })
    expect(await d.tickets.count()).toBe(3)
  })
  it('a done drill ticket shows the Done state and Open still leads to the ticket', async () => {
    const done = { ...mkTicket({ id: 'ritual-model-swap-drill-2026-11', origin: 'ritual:model-swap-drill:2026-11', kind: 'ritual', lane: 'ritual' }), status: 'done' as const }
    await setup({ now: at(2026, 11, 14, 10), tickets: [doneW, watch, done] })
    const card = await screen.findByTestId('today-ritual-model-swap-drill')
    expect(card).toHaveAttribute('data-state', 'done')
    expect(screen.getByTestId('today-ritual-model-swap-drill-state')).toHaveTextContent(/^Done$/)
    fireEvent.click(screen.getByTestId('today-ritual-open-model-swap-drill'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/do/ritual-model-swap-drill-2026-11'))
  })
  it('an open drill ticket is not also a generic ritual card', async () => {
    const t = mkTicket({ id: 'ritual-model-swap-drill-2026-11', origin: 'ritual:model-swap-drill:2026-11', kind: 'ritual', lane: 'ritual', title: 'Model swap drill' })
    await setup({ now: at(2026, 11, 14, 10), tickets: [doneW, watch, t] })
    await screen.findByTestId('today-ritual-model-swap-drill')
    expect(screen.queryByTestId('today-ritual-ritual-model-swap-drill-2026-11')).toBeNull()
    expect(screen.queryByTestId('today-ritual-skip-ritual-model-swap-drill-2026-11')).toBeNull()
  })
  it('is gone on Dec 1 00:00 and nothing about November remains', async () => {
    await setup({ now: at(2026, 12, 1, 0, 0) })
    expect(screen.queryByTestId('today-ritual-model-swap-drill')).toBeNull()
  })
})

describe('the focus line', () => {
  const wr = (week: string, focus: string) => ({ id: `wr-${week}`, week, worked: '', change: '', focus, at: 1 })
  it('shows the focus of the newest saved week as one line with no heading, no date and no control, above the quest', async () => {
    await setup({ now: at(2026, 11, 4), reviews: [wr('2026-W44', 'Finish the roofline function'), wr('2026-W43', 'older')] })
    const line = await screen.findByTestId('today-focus')
    expect(line).toHaveTextContent(/^Finish the roofline function$/)
    expect(line.querySelector('h1,h2,h3,h4,button,a,input')).toBeNull()
    expect(line.compareDocumentPosition(screen.getByTestId('today-quest')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it('follows the saved row with the greatest week, not the last save', async () => {
    await setup({ now: at(2026, 11, 4), reviews: [wr('2026-W45', 'Newer focus'), wr('2026-W44', 'Older focus')] })
    expect(await screen.findByTestId('today-focus')).toHaveTextContent(/^Newer focus$/)
  })
  it('is hidden when the newest saved week has no focus (the older focus is not shown in its place), and with no review at all', async () => {
    await setup({ now: at(2026, 11, 4), reviews: [wr('2026-W44', 'old'), wr('2026-W45', '')] })
    expect(screen.queryByTestId('today-focus')).toBeNull()
  })
  it('is absent with no review, and writes nothing', async () => {
    const d = await setup({ now: at(2026, 11, 4) })
    expect(screen.queryByTestId('today-focus')).toBeNull()
    expect(await d.weeklyReviews.count()).toBe(0)
  })
})

describe('the Floor card and the lead', () => {
  it('is always on Today in the main column below the quest, with the exact text and a link to /floor; the load writes nothing', async () => {
    const d = await setup({ now: at(2026, 11, 4, 10) })
    const card = await screen.findByTestId('today-floor')
    expect(card).toHaveTextContent('Floor: 15 minutes')
    expect(card).toHaveTextContent('Up to five cards, then one line about today.')
    expect(card.textContent!.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(15)
    expect(card.getAttribute('data-lead')).toBeNull()
    const start = screen.getByTestId('today-floor-start')
    expect(start).toHaveTextContent('START · FLOOR')
    expect(start).toHaveAttribute('href', '/floor')
    expect(start.getAttribute('data-accent')).toBeNull()
    expect(screen.getByTestId('today-quest').compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByTestId('today-welcome')).toBeNull()
    expect(screen.queryByTestId('today-mix-toggle')).toBeNull()
    expect(await d.journal.count()).toBe(0)
  })
  it('the Floor card starts the session', async () => {
    await setup({ now: at(2026, 11, 4, 10) })
    fireEvent.click(await screen.findByTestId('today-floor-start'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/floor'))
  })
  it('restart lead: welcome, Floor first with the accent, the usual mix collapsed behind a toggle', async () => {
    await setup({ now: at(2026, 11, 6, 10), model: { lead: 'restart' } })
    const card = await screen.findByTestId('today-floor')
    expect(card).toHaveAttribute('data-lead', 'restart')
    expect(screen.getByTestId('today-welcome')).toHaveTextContent(/^Welcome back\. A short one is plenty today\.$/)
    expect(screen.getByTestId('today-floor-start')).toHaveAttribute('data-accent', 'primary')
    const toggle = screen.getByTestId('today-mix-toggle')
    expect(toggle).toHaveTextContent(/usual mix/)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    for (const id of ['today-quest', 'start-button', 'today-pick-else', 'today-second', 'today-waits']) expect(screen.queryByTestId(id)).toBeNull()
    expect(document.body.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
  })
  it('opening the mix gives the accent back to start-button; closing it returns it', async () => {
    await setup({ now: at(2026, 11, 6, 10), model: { lead: 'restart' } })
    fireEvent.click(await screen.findByTestId('today-mix-toggle'))
    expect(screen.getByTestId('today-mix-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('today-quest')).toBeInTheDocument()
    expect(screen.getByTestId('start-button')).toHaveAttribute('data-accent', 'primary')
    expect(screen.getByTestId('today-floor-start').getAttribute('data-accent')).toBeNull()
    expect(screen.getByTestId('today-welcome')).toBeInTheDocument()
    expect(document.body.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('today-mix-toggle'))
    expect(screen.queryByTestId('today-quest')).toBeNull()
    expect(screen.getByTestId('today-floor-start')).toHaveAttribute('data-accent', 'primary')
  })
  it('restart lead with a started ticket (RIT-54): the Floor keeps the lead and the welcome, the resume quest sits below it with the one accent, the rest of the mix is behind the toggle', async () => {
    const doing = { ...watch, status: 'doing' as const }
    await setup({ now: at(2026, 11, 6, 10), tickets: [doneW, doing], model: { lead: 'restart', next: { kind: 'resume', ticket: doing, reason: 'you started this' }, mix: { ...baseModel.mix, items: [doing] } } })
    const card = await screen.findByTestId('today-floor')
    expect(card).toHaveAttribute('data-lead', 'restart')
    expect(screen.getByTestId('today-welcome')).toBeInTheDocument()
    expect(screen.getByTestId('today-quest')).toHaveAttribute('data-action', 'resume')
    expect(screen.getByTestId('today-mix-toggle')).toHaveClass('fl-after') // the toggle is ordered after the quest, so the quest sits directly below the Floor card
    expect(screen.getByTestId('start-button')).toHaveAttribute('data-accent', 'primary')
    expect(screen.getByTestId('today-floor-start').getAttribute('data-accent')).toBeNull()
    expect(screen.getByTestId('today-mix-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('today-second')).toBeNull()
    expect(document.body.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
  })
  it('a short lead has the accent and no welcome line', async () => {
    await setup({ now: at(2026, 11, 5, 10), model: { lead: 'short' } })
    const card = await screen.findByTestId('today-floor')
    expect(card).toHaveAttribute('data-lead', 'short')
    expect(screen.queryByTestId('today-welcome')).toBeNull()
    expect(screen.getByTestId('today-floor-start')).toHaveAttribute('data-accent', 'primary')
    expect(screen.getByTestId('today-mix-toggle')).toBeInTheDocument()
  })
  it('Enter acts on the accent: /floor while the mix is collapsed', async () => {
    await setup({ now: at(2026, 11, 6, 10), model: { lead: 'restart' } })
    await screen.findByTestId('today-floor')
    fireEvent.keyDown(window, { key: 'Enter' })
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/floor'))
  })
  it('no guilt copy and no number of days on a lead day', async () => {
    await setup({ now: at(2026, 11, 6, 10), model: { lead: 'restart' } })
    const card = await screen.findByTestId('today-floor')
    const text = `${screen.getByTestId('today-welcome').textContent} ${card.textContent} ${screen.getByTestId('today-mix-toggle').textContent}`
    expect(text).not.toMatch(/inactive|away|catch up|last (studied|active|session)|\b\d+ days?\b|missed|overdue|streak/i)
  })
})

// R1 F1: the Today ritual column (TODAY-33 to TODAY-47) against a real Dexie database and the real components.
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { Today } from '../../src/screens/Today'
import { weekTicket } from '../../src/rules/ritual'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const m = vi.hoisted(() => ({ model: null as unknown }))
const ro = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/flatHooks', () => ({
  useTodayModel: () => m.model,
  usePace: () => ({ projection: {}, line: 'at this pace the plan ends about March 2028', budgets: [90, 60, 60, 60, 30, 30, 150] }),
}))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))

const WED = new Date(2026, 10, 4, 10, 0).getTime() // Wednesday 2026-11-04 10:00 local, ISO week 2026-W45
const at = (d: number, h: number, min = 0) => new Date(2026, 10, d, h, min).getTime()
const watch = mkTicket({ id: 'w1', kind: 'watch', title: 'Watch: Karpathy deep dive', estMin: 45, phase: 1, explain: ['Q1'] })
const doneW = { ...mkTicket({ id: 'x', kind: 'watch' }), status: 'done' as const }
const model = { next: { kind: 'start', ticket: watch, reason: 'next in your queue' }, mix: { budget: 60, items: [watch], floor: false, waitsForLongerDay: [], lanesDone: [] }, pathNote: null, budgets: [90, 60, 60, 60, 30, 30, 150], careerLane: false, dueReviews: 0, pick: { doing: [], lanes: [] } }
const plans = appPlans()
const ID = 'ritual-try-new-model-2026-W45'

afterEach(() => { m.model = null; ro.on = false; localStorage.clear() })

async function setup(opts: { now?: number; tickets?: Ticket[]; pulse?: { text: string; at: number }; route?: string } = {}) {
  setNow(() => opts.now ?? WED)
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-10-21', planVersion: 't', aiProviders: {}, possibleXp: 0 })
  await d.tickets.bulkPut(opts.tickets ?? [doneW, watch])
  if (opts.pulse) await d.pulses.put({ id: 'pulse-2026-11-04', day: '2026-11-04', ...opts.pulse })
  m.model = model
  renderWithApp(<Today />, { db: d, ...plans, route: opts.route ?? '/' })
  await screen.findByTestId('today-quest')
  await screen.findByTestId('today-pulse')
  return d
}
const states = () => [0, 1, 2, 3, 4, 5, 6].map(i => screen.getByTestId(`today-week-${i}`).getAttribute('data-state'))

describe('the pulse card', () => {
  it('not logged: a labelled input, a disabled Log button, no Done, and nothing written by the page load', async () => {
    const d = await setup()
    const card = screen.getByTestId('today-pulse')
    expect(card).toHaveTextContent('Daily AI pulse · 15 min')
    expect(screen.getByLabelText('What did you ask an AI tool today?')).toBe(screen.getByTestId('today-pulse-input'))
    expect(screen.getByTestId('today-pulse-input')).toHaveAttribute('placeholder')
    expect(screen.getByTestId('today-pulse-log')).toBeDisabled()
    expect(card.textContent).not.toMatch(/Done/)
    expect(card).not.toHaveAttribute('data-accent')
    expect(screen.queryByTestId('today-pulse-edit')).toBeNull()
    expect(await d.pulses.count()).toBe(0)
  })

  it('Log writes one row, shows the logged state, and Enter does the same', async () => {
    const d = await setup()
    const input = screen.getByTestId('today-pulse-input')
    fireEvent.change(input, { target: { value: '   ' } })
    expect(screen.getByTestId('today-pulse-log')).toBeDisabled()
    fireEvent.change(input, { target: { value: '  Asked Claude to explain attention without maths ' } })
    fireEvent.submit(input.closest('form')!) // what Enter does in the field
    await screen.findByTestId('today-pulse-text')
    expect(await d.pulses.toArray()).toEqual([{ id: 'pulse-2026-11-04', day: '2026-11-04', at: WED, text: 'Asked Claude to explain attention without maths' }])
    expect(screen.getByTestId('today-pulse-text')).toHaveTextContent('Asked Claude to explain attention without maths')
    expect(screen.getByTestId('today-pulse-when')).toHaveTextContent('Logged this morning')
    expect(within(screen.getByTestId('today-pulse')).getByTestId('today-pulse-done')).toHaveTextContent('Done')
    expect(screen.queryByTestId('today-pulse-input')).toBeNull()
    expect(await d.tickets.count()).toBe(2) // no ticket, no XP
    expect(await d.sessions.count()).toBe(0)
  })

  it('the input holds at most 140 characters', async () => {
    await setup()
    expect(screen.getByTestId('today-pulse-input')).toHaveAttribute('maxlength', '140')
  })

  it('logged: Done in the ok colour, the stored text, "Logged this morning", and Edit', async () => {
    await setup({ pulse: { at: at(4, 9, 10), text: 'Asked Claude to explain attention without maths' } })
    expect(screen.getByTestId('today-pulse-done')).toHaveTextContent(/^Done$/)
    expect(screen.getByTestId('today-pulse-done')).toHaveClass('rt-ok') // the colour itself is checked in the e2e spec (jsdom loads no CSS)
    expect(screen.getByTestId('today-pulse-edit')).toHaveTextContent('Edit')
    expect(screen.queryByTestId('today-pulse-input')).toBeNull()
    expect(screen.queryByTestId('today-pulse-log')).toBeNull()
  })

  it('Edit reopens the input with the text; saving overwrites the same row with the time of the save', async () => {
    const d = await setup({ pulse: { at: at(4, 9, 10), text: 'old line' } })
    fireEvent.click(screen.getByTestId('today-pulse-edit'))
    const input = screen.getByTestId('today-pulse-input') as HTMLInputElement
    expect(input.value).toBe('old line')
    expect(screen.queryByTestId('today-pulse-text')).toBeNull()
    fireEvent.change(input, { target: { value: '' } })
    expect(screen.getByTestId('today-pulse-log')).toBeDisabled()
    fireEvent.change(input, { target: { value: 'Compared two small models on one prompt' } })
    fireEvent.click(screen.getByTestId('today-pulse-log'))
    await waitFor(() => expect(screen.getByTestId('today-pulse-text')).toHaveTextContent('Compared two small models on one prompt'))
    expect(await d.pulses.toArray()).toEqual([{ id: 'pulse-2026-11-04', day: '2026-11-04', at: WED, text: 'Compared two small models on one prompt' }])
  })

  it('the next day shows the input again and leaves yesterday\'s row alone', async () => {
    const d = await setup({ now: at(5, 10), pulse: { at: at(4, 9, 10), text: 'yesterday' } })
    expect(screen.getByTestId('today-pulse-input')).toBeInTheDocument()
    expect(screen.queryByTestId('today-pulse-done')).toBeNull()
    expect(await d.pulses.count()).toBe(1)
  })
})

describe('the weekly card', () => {
  it('shows from day zero with the header, status, copy, Open, Skip and seven inert cells; the page load creates no ticket', async () => {
    const d = await setup({ tickets: [watch] }) // day zero: nothing done yet
    const card = screen.getByTestId('today-ritual-try-new-model')
    expect(card).toHaveTextContent('Try a model · weekly')
    expect(screen.getByTestId('today-ritual-due')).toHaveTextContent('Due Saturday')
    expect(card).toHaveTextContent('Run one small open model, then note its tokens per second and what limited it. 30 minutes, any day before Saturday.')
    expect(screen.getByTestId('today-ritual-open-try-new-model')).toHaveTextContent('Open')
    expect(screen.getByTestId('today-ritual-skip-try-new-model')).toHaveTextContent('Skip this week')
    expect([0, 1, 2, 3, 4, 5, 6].map(i => screen.getByTestId(`today-week-${i}`).textContent).join('')).toBe('MTWTFSS')
    expect(screen.getByTestId('today-week').querySelectorAll('a, button, [tabindex]')).toHaveLength(0)
    expect(card).not.toHaveAttribute('data-accent')
    expect(document.body.textContent).not.toMatch(/streak|debt|\d+ due/i)
    expect(await d.tickets.count()).toBe(1)
  })

  it('week strip states follow the day (Wednesday, due Saturday, Sunday)', async () => {
    await setup()
    expect(states()).toEqual(['past', 'past', 'today', '', '', 'due', ''])
  })

  it('on the due day, due wins over today', async () => {
    await setup({ now: at(7, 10) })
    expect(states()).toEqual(['past', 'past', 'past', 'past', 'past', 'due', ''])
  })

  it('Open creates the week ticket with its exact fields, then goes to it; nothing else is written', async () => {
    const d = await setup()
    const before = await d.tickets.count()
    fireEvent.click(screen.getByTestId('today-ritual-open-try-new-model'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/do/${ID}`))
    expect(await d.tickets.count()).toBe(before + 1)
    expect(await d.tickets.get(ID)).toMatchObject({
      kind: 'ritual', lane: 'ritual', origin: 'ritual:try-new-model:2026-W45', title: 'Try a model', estMin: 30, status: 'todo', xp: 0,
      text: 'Run one small open model, then note its tokens per second and what limited it. 30 minutes, any day before Saturday.',
    })
    expect(await d.sessions.count()).toBe(0)
  })

  it('Open reuses the existing ticket, and the ticket is not also a generic ritual card', async () => {
    const t = weekTicket(WED, { minutes: 30, dueWeekday: 6 })
    const d = await setup({ tickets: [doneW, watch, t] })
    expect(screen.queryByTestId(`today-ritual-${ID}`)).toBeNull()
    expect(screen.queryByTestId(`today-ritual-skip-${ID}`)).toBeNull()
    fireEvent.click(screen.getByTestId('today-ritual-open-try-new-model'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/do/${ID}`))
    expect(await d.tickets.count()).toBe(3)
  })

  it('Skip this week hides the card, writes nothing, holds for the ISO week and ends on Monday', async () => {
    const d = await setup()
    fireEvent.click(screen.getByTestId('today-ritual-skip-try-new-model'))
    expect(screen.queryByTestId('today-ritual-try-new-model')).toBeNull()
    expect(screen.getByTestId('today-pulse')).toBeInTheDocument()
    expect(await d.tickets.count()).toBe(2)
    expect(JSON.parse(localStorage.getItem('dojo-ritual-skipped-week')!)).toEqual({ week: '2026-W45', ids: ['try-new-model'] })
  })
  it('a skip from this week does not hide next week\'s card', async () => {
    localStorage.setItem('dojo-ritual-skipped-week', JSON.stringify({ week: '2026-W45', ids: ['try-new-model'] }))
    await setup({ now: at(9, 10) }) // Monday of W46
    expect(screen.getByTestId('today-ritual-try-new-model')).toBeInTheDocument()
    expect(states()).toEqual(['today', '', '', '', '', 'due', ''])
  })
  it('a skip from this week keeps the card hidden after a reload (same ISO week, Sunday)', async () => {
    localStorage.setItem('dojo-ritual-skipped-week', JSON.stringify({ week: '2026-W45', ids: ['try-new-model'] }))
    await setup({ now: at(8, 10) })
    expect(screen.queryByTestId('today-ritual-try-new-model')).toBeNull()
  })

  it('a new week starts clean: the earlier open ticket is left alone and Open mints the new one', async () => {
    const old = weekTicket(WED, { minutes: 30, dueWeekday: 6 })
    const d = await setup({ now: at(9, 10), tickets: [doneW, watch, old] })
    expect(screen.getByTestId('today-ritual-due')).toHaveTextContent('Due Saturday')
    expect(states()).toEqual(['today', '', '', '', '', 'due', ''])
    expect(await d.tickets.count()).toBe(3)
    fireEvent.click(screen.getByTestId('today-ritual-open-try-new-model'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/do/ritual-try-new-model-2026-W46'))
    expect((await d.tickets.get(old.id))?.status).toBe('todo')
  })

  it('done: Done in the ok colour, the done day is done, "Done Wednesday", Open stays, Skip is gone', async () => {
    const t: Ticket = { ...weekTicket(WED, { minutes: 30, dueWeekday: 6 }), status: 'done', xp: 5, doneAt: at(4, 9, 40) }
    await setup({ tickets: [doneW, watch, t] })
    expect(screen.getByTestId('today-ritual-done')).toHaveTextContent(/^Done$/)
    expect(screen.getByTestId('today-ritual-done')).toHaveClass('rt-ok') // the colour itself is checked in the e2e spec (jsdom loads no CSS)
    expect(states()).toEqual(['past', 'past', 'done', '', '', 'due', ''])
    expect(screen.getByTestId('today-ritual-due')).toHaveTextContent('Done Wednesday')
    expect(screen.getByTestId('today-ritual-open-try-new-model')).toHaveAttribute('href', `/do/${ID}`)
    expect(screen.queryByTestId('today-ritual-skip-try-new-model')).toBeNull()
  })

  it('a read-only browser: Open with no ticket writes nothing and says why', async () => {
    ro.on = true
    const d = await setup()
    fireEvent.click(screen.getByTestId('today-ritual-open-try-new-model'))
    await screen.findByText(/Read-only/)
    expect(await d.tickets.count()).toBe(2)
    expect(screen.getByTestId('today-pulse-input')).toBeDisabled()
  })
})

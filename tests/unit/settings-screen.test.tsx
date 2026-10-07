import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Settings } from '../../src/screens/Settings'
import { getSettings, patchSettings } from '../../src/data/db'
import { resetPersistenceCache } from '../../src/data/persist'
import { setNow } from '../../src/lib/clock'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()

async function setup() {
  setNow(() => ist('2026-09-21T09:00:00'))
  const d = await seededDb()
  renderWithApp(<Settings />, { db: d, plan: smallPlan, route: '/settings' })
  return d
}

describe('Settings screen — storage durability (Important #3)', () => {
  afterEach(() => {
    resetPersistenceCache()
    // @ts-expect-error test cleanup of a jsdom-only global we stub per test
    delete navigator.storage
  })

  it('shows "persistent" when the browser grants persistence', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist: async () => true } })
    await setup()
    await waitFor(() => expect(screen.getByTestId('storage-status')).toHaveTextContent('persistent'))
  })

  it('shows "best-effort (browser may evict)" when the browser declines', async () => {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: { persist: async () => false } })
    await setup()
    await waitFor(() => expect(screen.getByTestId('storage-status')).toHaveTextContent('best-effort (browser may evict)'))
  })

  it('shows "unavailable" when navigator.storage.persist does not exist', async () => {
    await setup()
    await waitFor(() => expect(screen.getByTestId('storage-status')).toHaveTextContent('unavailable'))
  })
})

describe('Settings screen', () => {
  it('shows where today falls in the plan', async () => {
    await setup()
    expect(await screen.findByTestId('plan-position')).toHaveTextContent('Today is sprint 2, day 1 of 14.')
    expect(screen.getByTestId('plan-version')).toHaveTextContent('fx-1')
  })

  it('pluralizes "day" only when exactly 1 day remains (minor #6)', async () => {
    setNow(() => ist('2026-09-06T09:00:00'))
    const d = await seededDb(smallPlan, '2026-09-07')
    renderWithApp(<Settings />, { db: d, plan: smallPlan, route: '/settings' })
    expect(await screen.findByTestId('plan-position')).toHaveTextContent('Sprint 1 starts in 1 day.')
  })

  it('edits the start date', async () => {
    const d = await setup()
    const input = await screen.findByLabelText('Start date')
    fireEvent.change(input, { target: { value: '2026-09-21' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save start date' }))
    await waitFor(async () => expect((await getSettings(d)).startDate).toBe('2026-09-21'))
    expect(await screen.findByTestId('plan-position')).toHaveTextContent('Today is sprint 1, day 1 of 14.')
  })

  it('ruling 21: a non-Monday start date shows the warn note live and still saves', async () => {
    const d = await setup() // saved start 2026-09-07, a Monday: no note
    const input = await screen.findByLabelText('Start date')
    expect(screen.queryByTestId('start-date-warn')).toBeNull()
    fireEvent.change(input, { target: { value: '2026-09-2' } }) // half typed: not a date yet, no note
    expect(screen.queryByTestId('start-date-warn')).toBeNull()
    fireEvent.change(input, { target: { value: '2026-09-23' } })
    const warn = screen.getByTestId('start-date-warn')
    expect(warn).toHaveTextContent(
      'Sprints follow a Monday-to-Sunday rhythm (Monday is the AI watch day). Starting on Wednesday puts some of week 1 out of order. Pick a Monday to keep it in order.',
    )
    expect(warn).toHaveClass('form-warn')
    expect(input).toHaveAccessibleDescription(warn.textContent!)
    fireEvent.change(input, { target: { value: '2026-09-21' } })
    expect(screen.queryByTestId('start-date-warn')).toBeNull()
    fireEvent.change(input, { target: { value: '2026-09-22' } })
    expect(screen.getByTestId('start-date-warn')).toHaveTextContent('Starting on Tuesday puts')
    fireEvent.click(screen.getByRole('button', { name: 'Save start date' }))
    await waitFor(async () => expect((await getSettings(d)).startDate).toBe('2026-09-22'))
    expect(screen.queryByRole('alert')).toBeNull()
    // the saved non-Monday start keeps its note
    expect(await screen.findByTestId('start-date-warn')).toHaveTextContent('Starting on Tuesday puts')
  })

  it('rejects an invalid start date', async () => {
    const d = await setup()
    const input = await screen.findByLabelText('Start date')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save start date' }))
    // Settings' field is a text field with the ISO pattern, so its error names that format
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick a valid date (YYYY-MM-DD).')
    expect((await getSettings(d)).startDate).toBe('2026-09-07')
    // and it goes when a valid date is typed
    fireEvent.change(input, { target: { value: '2026-09-14' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('has no theme control and ignores a stored light theme (dark only)', async () => {
    const d = await setup()
    await patchSettings(d, { theme: 'light' } as never) // a stored value from before dark only: ignored
    await screen.findByLabelText('Start date')
    expect(screen.queryByRole('radio')).toBeNull()
    expect(screen.queryByText(/theme|workshop|console/i)).toBeNull()
    expect(document.documentElement.dataset.theme).not.toBe('light')
  })

  it('does not say the plan is complete while a live ticket sits past S72 (controller ruling #4)', async () => {
    setNow(() => ist('2029-06-11T09:00:00')) // the day after S72 ends
    const d = await seededDb(smallPlan, '2026-09-07')
    await d.tickets.put(mkTicket({ id: 'late', sprint: 73 }))
    renderWithApp(<Settings />, { db: d, plan: smallPlan, route: '/settings' })
    expect(await screen.findByTestId('plan-position')).toHaveTextContent('Today is sprint 73, day 1 of 14.')
  })

  it('lists archived tickets with kept XP', async () => {
    const d = await setup()
    await d.tickets.put(mkTicket({ id: 'gone', title: 'Old task', archived: true, xp: 10, status: 'done' }))
    expect(await screen.findByTestId('archived-list')).toHaveTextContent('Old task · 10 xp kept')
    expect(screen.getByText('Archived (plan changed) · 1')).toBeInTheDocument()
  })
})

describe('Settings screen — ui-settings ST1', () => {
  it('has exactly one h1 "Settings", an ISO start date field and a 160 px core-minutes field', async () => {
    await setup()
    const h1 = await screen.findByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Settings')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const date = screen.getByRole('textbox', { name: 'Start date' })
    expect(date).toHaveValue('2026-09-07')
    expect(date).toHaveAttribute('placeholder', 'YYYY-MM-DD')
    expect(screen.getByRole('spinbutton', { name: 'Core minutes per sprint' })).toHaveClass('num-160')
    expect(screen.getByTestId('plan-version').textContent).toMatch(/^Plan version /)
    expect(screen.getByTestId('storage-status').textContent).toMatch(/^Storage · /)
    expect(screen.queryByText(/best-effort/)).toBeNull()
  })
})

describe('Backups — ISO timestamps (ST1 #3)', () => {
  it('formats a snapshot time as YYYY-MM-DD HH:MM local, never a locale string', async () => {
    const { isoMinute } = await import('../../src/screens/Backups')
    expect(isoMinute('2026-10-03T17:00:00.000Z')).toBe('2026-10-03 22:30')
    expect(isoMinute('nope')).toBe('nope')
  })
})

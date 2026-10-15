import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Settings } from '../../src/screens/Settings'
import { getSettings, patchSettings } from '../../src/data/db'
import { resetPersistenceCache } from '../../src/data/persist'
import { setNow } from '../../src/lib/clock'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()

async function setup() {
  setNow(() => ist('2026-09-21T09:00:00'))
  const d = await seededDb()
  renderWithApp(<Settings />, { db: d, plan: flatPlanV2, route: '/settings' })
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
    expect(await screen.findByTestId('plan-position')).toHaveTextContent('Day 15 of your plan.')
    expect(screen.getByTestId('plan-version')).toHaveTextContent('fx-v2-1')
  })

  it('pluralizes "day" only when exactly 1 day remains (minor #6)', async () => {
    setNow(() => ist('2026-09-06T09:00:00'))
    const d = await seededDb(flatPlanV2, '2026-09-07')
    renderWithApp(<Settings />, { db: d, plan: flatPlanV2, route: '/settings' })
    expect(await screen.findByTestId('plan-position')).toHaveTextContent('Your plan starts in 1 day.')
  })

  it('edits the start date', async () => {
    const d = await setup()
    const input = await screen.findByLabelText('Start date')
    fireEvent.change(input, { target: { value: '2026-09-21' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save start date' }))
    await waitFor(async () => expect((await getSettings(d)).startDate).toBe('2026-09-21'))
    expect(await screen.findByTestId('plan-position')).toHaveTextContent('Day 1 of your plan.')
  })

  it('any weekday start date saves with no warn note (weekday roles are gone, TODAY-08)', async () => {
    const d = await setup() // saved start 2026-09-07
    const input = await screen.findByLabelText('Start date')
    expect(screen.queryByTestId('start-date-warn')).toBeNull()
    for (const v of ['2026-09-2', '2026-09-23', '2026-09-21', '2026-09-22']) {
      fireEvent.change(input, { target: { value: v } })
      expect(screen.queryByTestId('start-date-warn')).toBeNull()
    }
    expect(input).not.toHaveAttribute('aria-describedby')
    fireEvent.click(screen.getByRole('button', { name: 'Save start date' }))
    await waitFor(async () => expect((await getSettings(d)).startDate).toBe('2026-09-22'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByTestId('start-date-warn')).toBeNull()
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

  it('lists archived tickets with kept XP', async () => {
    const d = await setup()
    await d.tickets.put(mkTicket({ id: 'gone', title: 'Old task', archived: true, xp: 10, status: 'done' }))
    expect(await screen.findByTestId('archived-list')).toHaveTextContent('Old task · 10 xp kept')
    expect(screen.getByText('Archived (plan changed) · 1')).toBeInTheDocument()
  })
})

describe('Settings screen — ui-settings ST1', () => {
  it('has an ISO start date field and a 160 px Sunday budget field (the h1 comes from the shell)', async () => {
    await setup()
    await screen.findByTestId('settings-pace')
    const date = screen.getByRole('textbox', { name: 'Start date' })
    expect(date).toHaveValue('2026-09-07')
    expect(date).toHaveAttribute('placeholder', 'YYYY-MM-DD')
    expect(screen.getByTestId('settings-budget-0')).toHaveClass('num-160')
    expect(screen.getByTestId('plan-version').textContent).toMatch(/^Plan version /)
    expect(screen.getByTestId('storage-status').textContent).toMatch(/^Storage · /)
    expect(screen.queryByText(/best-effort/)).toBeNull()
  })
})

describe('Backups — ISO timestamps (ST1 #3)', () => {
  it('formats a snapshot time as YYYY-MM-DD HH:MM local, never a locale string', async () => {
    const { isoMinute } = await import('../../src/screens/Backups')
    expect(isoMinute(Date.parse('2026-10-03T17:00:00.000Z'))).toBe('2026-10-03 22:30')
    expect(isoMinute(Number.NaN)).toBe('NaN')
  })
})

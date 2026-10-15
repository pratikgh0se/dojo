import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { getSettings } from '../../src/data/db'
import { setNow } from '../../src/lib/clock'
import { Settings } from '../../src/screens/Settings'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/planV2'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthIndex = (line: string) => {
  const m = /about (\w+) (\d{4})/.exec(line)!
  return Number(m[2]) * 12 + MONTHS.indexOf(m[1])
}

async function setup() {
  setNow(() => new Date(2026, 10, 2, 10).getTime())
  const d = await seededDb(flatPlanV2, '2026-11-02')
  await d.tickets.clear()
  await d.tickets.bulkPut(Array.from({ length: 100 }, (_, i) => mkTicket({ id: `t${i}`, lane: 'path', estMin: 600, order: i })))
  renderWithApp(<Settings />, { db: d, plan: flatPlanV2, route: '/settings' })
  await screen.findByTestId('settings-pace')
  return d
}

describe('Settings: pace', () => {
  it('shows seven weekday budgets, Sunday first, with the defaults and a projection line', async () => {
    await setup()
    const want = [90, 60, 60, 60, 30, 30, 150]
    want.forEach((m, i) => expect(screen.getByTestId(`settings-budget-${i}`)).toHaveValue(String(m)))
    expect(screen.getByLabelText(/Sunday/)).toBe(screen.getByTestId('settings-budget-0'))
    expect(screen.getByLabelText(/Saturday/)).toBe(screen.getByTestId('settings-budget-6'))
    // rendered exactly as paceLine returns it: lowercase, no full stop (SET-02)
    expect(screen.getByTestId('settings-pace-projection')).toHaveTextContent(/^at this pace the plan ends about \w+ \d{4}$/)
  })

  it('moves the projection at once and stores seven numbers when a budget is raised', async () => {
    const d = await setup()
    const before = monthIndex(screen.getByTestId('settings-pace-projection').textContent!)
    fireEvent.change(screen.getByTestId('settings-budget-1'), { target: { value: '120' } })
    expect(monthIndex(screen.getByTestId('settings-pace-projection').textContent!)).toBeLessThanOrEqual(before)
    await waitFor(async () => expect((await getSettings(d)).laneBudgets).toEqual([90, 120, 60, 60, 30, 30, 150]))
  })

  it('moves the projection later when a budget is lowered, trims nothing and uses no blame words', async () => {
    const d = await setup()
    const before = monthIndex(screen.getByTestId('settings-pace-projection').textContent!)
    fireEvent.change(screen.getByTestId('settings-budget-3'), { target: { value: '15' } })
    expect(monthIndex(screen.getByTestId('settings-pace-projection').textContent!)).toBeGreaterThan(before)
    await waitFor(async () => expect((await getSettings(d)).laneBudgets![3]).toBe(15))
    expect(await d.tickets.count()).toBe(100)
    expect(screen.getByTestId('settings-pace').textContent).not.toMatch(/behind|late|overdue/i)
  })

  it('refuses a bad value with one settings-pace-error sentence inside settings-pace and keeps the stored budgets (SET-08)', async () => {
    const d = await setup()
    expect(screen.queryByTestId('settings-pace-error')).toBeNull()
    const field = screen.getByTestId('settings-budget-2')
    for (const bad of ['601', '-5', 'abc', '1.5', '']) {
      fireEvent.change(field, { target: { value: bad } })
      const err = screen.getByTestId('settings-pace-error')
      expect(screen.getByTestId('settings-pace')).toContainElement(err)
      expect(screen.getAllByTestId('settings-pace-error')).toHaveLength(1)
      expect(err.textContent).toMatch(/^[^.]+\.$/) // one sentence
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(field).toHaveAttribute('aria-describedby', 'settings-pace-error')
    }
    await new Promise(r => setTimeout(r, 40))
    expect((await getSettings(d)).laneBudgets).toBeUndefined()
    fireEvent.change(field, { target: { value: '45' } })
    expect(screen.queryByTestId('settings-pace-error')).toBeNull()
    await waitFor(async () => expect((await getSettings(d)).laneBudgets![2]).toBe(45))
  })
})

describe('Settings: pace typed key by key (SET-08)', () => {
  it('stores nothing while "601" is typed in, though "6" and "60" are valid on the way', async () => {
    const d = await setup()
    const field = screen.getByTestId('settings-budget-1')
    for (const v of ['6', '60', '601']) fireEvent.change(field, { target: { value: v } })
    await new Promise(r => setTimeout(r, 900))
    expect((await getSettings(d)).laneBudgets).toBeUndefined()
    expect(screen.getByTestId('settings-pace-error')).toBeInTheDocument()
  })

  it('saves a valid typed number once the typing stops, and on leaving the field', async () => {
    const d = await setup()
    const field = screen.getByTestId('settings-budget-1')
    for (const v of ['1', '12', '120']) fireEvent.change(field, { target: { value: v } })
    expect((await getSettings(d)).laneBudgets).toBeUndefined()
    await waitFor(async () => expect((await getSettings(d)).laneBudgets).toEqual([90, 120, 60, 60, 30, 30, 150]), { timeout: 2000 })
    fireEvent.change(field, { target: { value: '45' } })
    fireEvent.blur(field)
    await waitFor(async () => expect((await getSettings(d)).laneBudgets![1]).toBe(45))
  })
})

describe('Settings: preferences', () => {
  it('stores the career lane, the labels switch and the session length', async () => {
    const d = await setup()
    fireEvent.click(screen.getByTestId('settings-career-lane'))
    await waitFor(async () => expect((await getSettings(d)).careerLane).toBe(true))
    fireEvent.click(screen.getByTestId('settings-nav-labels'))
    await waitFor(async () => expect((await getSettings(d)).navLabels).toBe('always'))
    fireEvent.click(screen.getByTestId('settings-nav-labels'))
    await waitFor(async () => expect((await getSettings(d)).navLabels).toBe('hover'))
    fireEvent.change(screen.getByTestId('settings-session-minutes'), { target: { value: '40' } })
    await waitFor(async () => expect((await getSettings(d)).sessionMinutes).toBe(40))
    for (const bad of ['3', 'abc', '181']) {
      fireEvent.change(screen.getByTestId('settings-session-minutes'), { target: { value: bad } })
      expect(screen.getByTestId('settings-session-minutes')).toHaveAttribute('aria-invalid', 'true')
    }
    await new Promise(r => setTimeout(r, 40))
    expect((await getSettings(d)).sessionMinutes).toBe(40)
  })

  it('keeps the existing hooks and names no sprint', async () => {
    await setup()
    expect(screen.getByTestId('plan-position')).toHaveTextContent(/^Day 1 of your plan\.$/)
    expect(screen.getByTestId('plan-version')).toBeInTheDocument()
    expect(screen.getByTestId('storage-status')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/sprint|core minutes/i)
  })

  it('wraps archived plan text in data-content="plan"', async () => {
    const d = await setup()
    await d.tickets.put(mkTicket({ id: 'gone-interview', title: 'Old interview task', archived: true, xp: 10, status: 'done' }))
    const list = await screen.findByTestId('archived-list')
    const li = list.querySelector('li')!
    expect(li.querySelectorAll('[data-content="plan"]')).toHaveLength(2)
    expect(li).toHaveTextContent('Old interview task · 10 xp kept')
  })
})

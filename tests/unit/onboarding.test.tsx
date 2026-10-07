import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/app/App'
import { getSettings, patchSettings } from '../../src/data/db'
import { setNow } from '../../src/lib/clock'
import { defaultStartDate, MID_WEEK_NOTE, startDateNote, startDateWarning } from '../../src/rules/onboarding'
import { freshDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const serve: typeof fetch = (async () => ({ ok: true, status: 200, json: async () => smallPlan }) as unknown as Response)

const WARN = (day: string) =>
  `Sprints follow a Monday-to-Sunday rhythm (Monday is the AI watch day). Starting on ${day} puts some of week 1 out of order. Pick a Monday to keep it in order.`

// Controller ruling 21 (amends ruling 19's "today"): sprints start on a Monday because the day types are weekday-bound.
// Today on a Monday; the Monday just gone if it is at most 2 days back (Tue, Wed); otherwise next Monday. Local dates.
describe('defaultStartDate', () => {
  it.each([
    ['Monday', '2026-10-05T10:00:00', '2026-10-05'],
    ['Tuesday', '2026-10-06T10:00:00', '2026-10-05'],
    ['Wednesday', '2026-10-07T10:00:00', '2026-10-05'],
    ['Thursday', '2026-10-08T10:00:00', '2026-10-12'],
    ['Friday', '2026-10-09T10:00:00', '2026-10-12'],
    ['Saturday', '2026-10-10T10:00:00', '2026-10-12'],
    ['Sunday', '2026-10-11T10:00:00', '2026-10-12'],
  ])('on a %s (%s) it is %s', (_day, at, want) => expect(defaultStartDate(ist(at))).toBe(want))

  it('goes by the local day, not UTC: just after local midnight and just before it', () => {
    expect(defaultStartDate(ist('2026-10-05T00:30:00'))).toBe('2026-10-05') // Monday locally, still Sunday in UTC
    expect(defaultStartDate(ist('2026-10-07T23:59:00'))).toBe('2026-10-05') // Wednesday, late evening
    expect(defaultStartDate(ist('2026-10-08T00:01:00'))).toBe('2026-10-12') // Thursday has begun: next Monday
    expect(defaultStartDate(ist('2026-10-11T23:59:00'))).toBe('2026-10-12') // Sunday night
  })

  it('crosses month and year ends', () => {
    expect(defaultStartDate(ist('2026-09-01T10:00:00'))).toBe('2026-08-31') // Tuesday → the Monday in August
    expect(defaultStartDate(ist('2026-12-31T10:00:00'))).toBe('2027-01-04') // Thursday → the Monday in January
  })
})

describe('startDateWarning', () => {
  it('is null for a Monday, and for text that is not a date yet', () => {
    expect(startDateWarning('2026-10-05')).toBeNull()
    expect(startDateWarning('2026-10-12')).toBeNull()
    for (const v of ['', '2026-10', '2026-02-30', 'nope']) expect(startDateWarning(v)).toBeNull()
  })
  it.each([
    ['2026-10-06', 'Tuesday'], ['2026-10-07', 'Wednesday'], ['2026-10-08', 'Thursday'],
    ['2026-10-09', 'Friday'], ['2026-10-10', 'Saturday'], ['2026-10-11', 'Sunday'],
  ])('names the weekday of %s (%s)', (iso, day) => expect(startDateWarning(iso)).toBe(WARN(day)))
})

// Controller ruling 22 D3 (UAT r7 P3 #1): the Tue/Wed default (the Monday just gone) says why it is in the past.
describe('startDateNote', () => {
  it('is the note for the Monday just gone, on a Tuesday or a Wednesday', () => {
    expect(MID_WEEK_NOTE).toBe("Week 1 started on Monday; its first day's items are on the Board.")
    expect(startDateNote('2026-10-05', ist('2026-10-06T10:00:00'))).toBe(MID_WEEK_NOTE)
    expect(startDateNote('2026-10-05', ist('2026-10-07T23:59:00'))).toBe(MID_WEEK_NOTE)
    expect(startDateNote('2026-08-31', ist('2026-09-01T10:00:00'))).toBe(MID_WEEK_NOTE) // across a month end
  })
  it('is null for any other date, on any other day, and for text that is not a date', () => {
    expect(startDateNote('2026-10-05', ist('2026-10-05T10:00:00'))).toBeNull() // Monday: today is the default
    expect(startDateNote('2026-10-05', ist('2026-10-08T10:00:00'))).toBeNull() // Thursday: next Monday is the default
    expect(startDateNote('2026-10-06', ist('2026-10-06T10:00:00'))).toBeNull() // today, a Tuesday
    expect(startDateNote('2026-10-12', ist('2026-10-06T10:00:00'))).toBeNull()
    expect(startDateNote('2026-09-28', ist('2026-10-06T10:00:00'))).toBeNull() // an older Monday
    for (const v of ['', '2026-10', 'nope']) expect(startDateNote(v, ist('2026-10-06T10:00:00'))).toBeNull()
  })
})

describe('first-launch onboarding', () => {
  it('asks for a start date on an empty DB, defaulting to a Monday, then opens the app', async () => {
    setNow(() => ist('2026-09-27T10:00:00')) // a Sunday: next Monday
    const d = freshDb()
    render(<MemoryRouter><App database={d} fetcher={serve} /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Pick your start date' })).toBeInTheDocument()
    const input = screen.getByLabelText('Start date') as HTMLInputElement
    expect(input.value).toBe('2026-09-28')
    expect(screen.queryByTestId('start-date-warn')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Board' })).toBeNull()

    fireEvent.change(input, { target: { value: '2026-09-07' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start the plan ▸' }))
    expect(await screen.findByRole('link', { name: 'Board' })).toBeInTheDocument()
    expect((await getSettings(d)).startDate).toBe('2026-09-07')
  })

  it('ruling 21: a non-Monday shows the warn note live, Monday clears it, and it never blocks Start the plan', async () => {
    setNow(() => ist('2026-10-06T10:00:00')) // a Tuesday: the Monday just gone
    const d = freshDb()
    render(<MemoryRouter><App database={d} fetcher={serve} /></MemoryRouter>)
    const input = (await screen.findByLabelText('Start date')) as HTMLInputElement
    expect(input.value).toBe('2026-10-05')
    expect(screen.queryByTestId('start-date-warn')).toBeNull()

    fireEvent.change(input, { target: { value: '2026-10-08' } })
    const warn = screen.getByTestId('start-date-warn')
    expect(warn).toHaveTextContent(WARN('Thursday'))
    expect(warn).toHaveClass('form-warn')
    expect(warn).not.toHaveAttribute('role', 'alert')
    expect(input).toHaveAccessibleDescription(WARN('Thursday'))
    fireEvent.change(input, { target: { value: '2026-10-11' } })
    expect(screen.getByTestId('start-date-warn')).toHaveTextContent(WARN('Sunday'))
    fireEvent.change(input, { target: { value: '2026-10-12' } })
    expect(screen.queryByTestId('start-date-warn')).toBeNull()
    expect(input).not.toHaveAttribute('aria-describedby')

    fireEvent.change(input, { target: { value: '2026-10-06' } })
    expect(screen.getByTestId('start-date-warn')).toHaveTextContent(WARN('Tuesday'))
    fireEvent.click(screen.getByRole('button', { name: 'Start the plan ▸' }))
    expect(await screen.findByRole('link', { name: 'Board' })).toBeInTheDocument()
    expect((await getSettings(d)).startDate).toBe('2026-10-06')
  })

  it('ruling 22 D3: on a Tuesday the default Monday carries the one-line note; another date drops it', async () => {
    setNow(() => ist('2026-10-06T10:00:00'))
    render(<MemoryRouter><App database={freshDb()} fetcher={serve} /></MemoryRouter>)
    const input = (await screen.findByLabelText('Start date')) as HTMLInputElement
    expect(input.value).toBe('2026-10-05')
    const note = screen.getByTestId('start-date-note')
    expect(note).toHaveTextContent("Week 1 started on Monday; its first day's items are on the Board.")
    expect(note).toHaveClass('form-note')
    expect(input).toHaveAccessibleDescription("Week 1 started on Monday; its first day's items are on the Board.")
    fireEvent.change(input, { target: { value: '2026-10-06' } })
    expect(screen.queryByTestId('start-date-note')).toBeNull()
    expect(screen.getByTestId('start-date-warn')).toHaveTextContent(WARN('Tuesday'))
    fireEvent.change(input, { target: { value: '2026-10-05' } })
    expect(screen.getByTestId('start-date-note')).toBeInTheDocument()
    expect(screen.queryByTestId('start-date-warn')).toBeNull()
  })

  it('ruling 22 D3: no note when the default is today (a Monday) or next Monday', async () => {
    setNow(() => ist('2026-10-08T10:00:00')) // Thursday
    render(<MemoryRouter><App database={freshDb()} fetcher={serve} /></MemoryRouter>)
    expect(((await screen.findByLabelText('Start date')) as HTMLInputElement).value).toBe('2026-10-12')
    expect(screen.queryByTestId('start-date-note')).toBeNull()
  })

  it('rejects an invalid date and writes nothing', async () => {
    setNow(() => ist('2026-09-27T10:00:00'))
    const d = freshDb()
    render(<MemoryRouter><App database={d} fetcher={serve} /></MemoryRouter>)
    const input = await screen.findByLabelText('Start date')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.submit(input.closest('form')!)
    // P3-3: the native date field shows the user's own format (dd/mm/yyyy), so its error names none
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/^Pick a valid date\.$/)
    expect(alert.textContent).not.toMatch(/YYYY/)
    expect((await getSettings(d)).startDate).toBe('')
  })

  it('P3-2: the error goes the moment a valid date is picked, with its red border; an empty date keeps it', async () => {
    setNow(() => ist('2026-09-27T10:00:00'))
    render(<MemoryRouter><App database={freshDb()} fetcher={serve} /></MemoryRouter>)
    const input = await screen.findByLabelText('Start date')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.submit(input.closest('form')!)
    await screen.findByRole('alert')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    fireEvent.change(input, { target: { value: '' } }) // still no date: the error stays
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '2026-10-05' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAccessibleDescription(/Pick a valid date/)
  })

  it('skips onboarding once a start date exists', async () => {
    setNow(() => ist('2026-09-27T10:00:00'))
    const d = freshDb()
    await patchSettings(d, { startDate: '2026-09-07' })
    render(<MemoryRouter><App database={d} fetcher={serve} /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Board' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Pick your start date' })).toBeNull())
  })
})

describe('Addendum 7: read-only everywhere, onboarding included', () => {
  it('shows readonly-banner on onboarding; Start the plan ▸ refuses with the "Read-only" toast and writes nothing', async () => {
    const { createDb, syncGate } = await import('../../src/data/db')
    const { ToastProvider } = await import('../../src/ui/primitives')
    setNow(() => ist('2026-09-27T10:00:00'))
    const d = createDb(`ro-onboard-${Math.random()}`, { bypass: false, readOnly: true })
    syncGate.readOnly = true
    try {
      render(<MemoryRouter><ToastProvider><App database={d} fetcher={serve} /></ToastProvider></MemoryRouter>)
      expect(await screen.findByRole('heading', { name: 'Pick your start date' })).toBeInTheDocument()
      expect(screen.getByTestId('readonly-banner')).toHaveTextContent(/^Read-only/)
      fireEvent.click(screen.getByRole('button', { name: 'Start the plan ▸' }))
      await waitFor(() => expect(screen.getAllByTestId('toast').some(t => /^Read-only/.test(t.textContent ?? ''))).toBe(true))
      expect(screen.queryByRole('alert')).toBeNull()
      expect((await getSettings(d)).startDate).toBe('')
    } finally {
      syncGate.readOnly = false
    }
  })
})

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/app/App'
import { getSettings, patchSettings } from '../../src/data/db'
import { setNow } from '../../src/lib/clock'
import { defaultStartDate, startDateNote, startDateWarning } from '../../src/rules/onboarding'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const serve: typeof fetch = (async () => ({ ok: true, status: 200, json: async () => flatPlanV2 }) as unknown as Response)

// Weekday roles are gone (TODAY-08: a weekday is only a minutes budget), so the default start date is today on the local
// calendar, and neither the Monday warn note nor the mid-week note ever applies (SHELL-27 shows them "when they apply").
describe('defaultStartDate', () => {
  it.each([
    ['Monday', '2026-10-05T10:00:00', '2026-10-05'],
    ['Tuesday', '2026-10-06T10:00:00', '2026-10-06'],
    ['Wednesday', '2026-10-07T10:00:00', '2026-10-07'],
    ['Thursday', '2026-10-08T10:00:00', '2026-10-08'],
    ['Friday', '2026-10-09T10:00:00', '2026-10-09'],
    ['Saturday', '2026-10-10T10:00:00', '2026-10-10'],
    ['Sunday', '2026-10-11T10:00:00', '2026-10-11'],
  ])('on a %s (%s) it is today, %s', (_day, at, want) => expect(defaultStartDate(ist(at))).toBe(want))

  it('goes by the local day, not UTC: just after local midnight and just before it', () => {
    expect(defaultStartDate(ist('2026-10-05T00:30:00'))).toBe('2026-10-05') // still the 4th in UTC
    expect(defaultStartDate(ist('2026-10-07T23:59:00'))).toBe('2026-10-07')
    expect(defaultStartDate(ist('2026-10-08T00:01:00'))).toBe('2026-10-08')
  })

  it('crosses month and year ends', () => {
    expect(defaultStartDate(ist('2026-09-01T00:10:00'))).toBe('2026-09-01')
    expect(defaultStartDate(ist('2026-12-31T23:50:00'))).toBe('2026-12-31')
  })
})

describe('startDateWarning and startDateNote', () => {
  it('never apply: null for a Monday, any other weekday, and text that is not a date', () => {
    for (const v of ['2026-10-05', '2026-10-06', '2026-10-11', '', '2026-10', '2026-02-30', 'nope']) expect(startDateWarning(v)).toBeNull()
    for (const v of ['2026-10-05', '2026-10-06', '', 'nope']) expect(startDateNote(v, ist('2026-10-06T10:00:00'))).toBeNull()
  })
})

describe('first-launch onboarding', () => {
  it('asks for a start date on an empty DB, defaulting to today, then opens the app', async () => {
    setNow(() => ist('2026-09-27T10:00:00')) // a Sunday: today
    const d = freshDb()
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve} /></MemoryRouter>)
    expect(await screen.findByRole('heading', { name: 'Pick your start date' })).toBeInTheDocument()
    const input = screen.getByLabelText('Start date') as HTMLInputElement
    expect(input.value).toBe('2026-09-27')
    expect(screen.queryByTestId('start-date-warn')).toBeNull()
    expect(screen.queryByTestId('start-date-note')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Path' })).toBeNull()

    fireEvent.change(input, { target: { value: '2026-09-07' } })
    fireEvent.click(screen.getByRole('button', { name: 'START · PLAN' }))
    expect(await screen.findByRole('link', { name: 'Path' })).toBeInTheDocument()
    expect((await getSettings(d)).startDate).toBe('2026-09-07')
  })

  it('no weekday note or warning on any date, and no Board, Sprint or "AI watch day" text', async () => {
    setNow(() => ist('2026-10-06T10:00:00')) // a Tuesday
    const d = freshDb()
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve} /></MemoryRouter>)
    const input = (await screen.findByLabelText('Start date')) as HTMLInputElement
    expect(input.value).toBe('2026-10-06')
    for (const v of ['2026-10-06', '2026-10-08', '2026-10-11', '2026-10-12']) {
      fireEvent.change(input, { target: { value: v } })
      expect(screen.queryByTestId('start-date-warn')).toBeNull()
      expect(screen.queryByTestId('start-date-note')).toBeNull()
      expect(input).not.toHaveAttribute('aria-describedby')
    }
    expect(screen.getByTestId('screen-onboarding').textContent ?? '').not.toMatch(/Board|Sprint|AI watch day/)
    fireEvent.change(input, { target: { value: '2026-10-08' } })
    fireEvent.click(screen.getByRole('button', { name: 'START · PLAN' })) // any weekday starts the plan
    expect(await screen.findByRole('link', { name: 'Path' })).toBeInTheDocument()
    expect((await getSettings(d)).startDate).toBe('2026-10-08')
  })

  it('SHELL-27: the one accent button is onboarding-submit labelled START · PLAN, the date input is onboarding-start-date', async () => {
    setNow(() => ist('2026-09-27T10:00:00'))
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={freshDb()} fetcher={serve} /></MemoryRouter>)
    const submit = await screen.findByTestId('onboarding-submit')
    expect(submit).toHaveTextContent(/^START · PLAN$/)
    expect(submit.textContent).toMatch(/^[A-Za-z]+ · .+$/) // GLOBAL-03
    expect(submit).toHaveAttribute('data-accent', 'primary')
    expect(document.querySelectorAll('[data-accent]')).toHaveLength(1)
    expect(screen.getByTestId('onboarding-start-date')).toBe(screen.getByLabelText('Start date'))
    expect(screen.queryByText(/Sprint 1 of 72|14 days/)).toBeNull()
  })

  it('SHELL-27: clearing the date and pressing onboarding-submit shows form-error and writes nothing', async () => {
    setNow(() => ist('2026-09-27T10:00:00'))
    const d = freshDb()
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve} /></MemoryRouter>)
    fireEvent.change(await screen.findByTestId('onboarding-start-date'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('onboarding-submit'))
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Pick a valid date.')
    expect((await getSettings(d)).startDate).toBe('')
  })

  it('SHELL-27: a valid date and onboarding-submit save the start date', async () => {
    setNow(() => ist('2026-09-27T10:00:00'))
    const d = freshDb()
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve} /></MemoryRouter>)
    fireEvent.change(await screen.findByTestId('onboarding-start-date'), { target: { value: '2026-09-14' } })
    fireEvent.click(screen.getByTestId('onboarding-submit'))
    await waitFor(async () => expect((await getSettings(d)).startDate).toBe('2026-09-14'))
  })

  it('rejects an invalid date and writes nothing', async () => {
    setNow(() => ist('2026-09-27T10:00:00'))
    const d = freshDb()
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve} /></MemoryRouter>)
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
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={freshDb()} fetcher={serve} /></MemoryRouter>)
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
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={serve} /></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Path' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Pick your start date' })).toBeNull())
  })
})

describe('Addendum 7: read-only everywhere, onboarding included', () => {
  it('shows readonly-banner on onboarding; START · PLAN refuses with the "Read-only" toast and writes nothing', async () => {
    const { createDb, syncGate } = await import('../../src/data/db')
    const { ToastProvider } = await import('../../src/ui/primitives')
    setNow(() => ist('2026-09-27T10:00:00'))
    const d = createDb(`ro-onboard-${Math.random()}`, { bypass: false, readOnly: true })
    syncGate.readOnly = true
    try {
      render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><ToastProvider><App database={d} fetcher={serve} /></ToastProvider></MemoryRouter>)
      expect(await screen.findByRole('heading', { name: 'Pick your start date' })).toBeInTheDocument()
      expect(screen.getByTestId('readonly-banner')).toHaveTextContent(/^Read-only/)
      fireEvent.click(screen.getByRole('button', { name: 'START · PLAN' }))
      await waitFor(() => expect(screen.getAllByTestId('toast').some(t => /^Read-only/.test(t.textContent ?? ''))).toBe(true))
      expect(screen.queryByRole('alert')).toBeNull()
      expect((await getSettings(d)).startDate).toBe('')
    } finally {
      syncGate.readOnly = false
    }
  })
})

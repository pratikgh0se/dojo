import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftBrief } from '../../src/data/briefActions'
import { setNow } from '../../src/lib/clock'
import { openCheck } from '../../src/lib/checkGate'
import { CheckGate } from '../../src/screens/brief/CheckGate'
import { Reviews } from '../../src/screens/progress/Reviews'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

// briefs Addendum 6 (BR-23): "Check answers" and "Build review" are refused up front in a read-only
// browser, with the Read-only toast, before any AI job runs.
const calls = vi.hoisted(() => ({ n: 0 }))
vi.mock('../../src/data/aiActions', async orig => {
  const m = await orig<typeof import('../../src/data/aiActions')>()
  return { ...m, callJob: (...a: Parameters<typeof m.callJob>) => { calls.n++; return m.callJob(...a) } }
})

const NOW = new Date(2026, 8, 8, 12).getTime()
afterEach(() => {
  localStorage.clear()
  localStorage.setItem('dojo.writer', 'test-writer')
  calls.n = 0
})

describe('read-only: no AI job from the check or the review', () => {
  it('Check answers shows the Read-only toast and grades nothing', async () => {
    setNow(() => NOW)
    const d = await seededDb()
    await d.tickets.put(mkTicket({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps', sprint: 1 }))
    await draftBrief(d, 'w1', NOW)
    calls.n = 0
    renderWithApp(<CheckGate />, { db: d, plan: smallPlan })
    openCheck('w1')
    const dialog = await screen.findByRole('dialog', { name: 'Check your understanding' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'about hash maps' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Hash maps' }))
    localStorage.removeItem('dojo.writer')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Check answers' }))
    expect(await screen.findByText(/^Read-only/)).toBeInTheDocument()
    expect(calls.n).toBe(0)
    expect(await d.checkAttempts.count()).toBe(0)
    expect((await d.tickets.get('w1'))!.status).toBe('todo')
  })

  it('Build review shows the Read-only toast and builds nothing', async () => {
    setNow(() => NOW)
    const d = await seededDb()
    renderWithApp(<Reviews />, { db: d, plan: smallPlan })
    localStorage.removeItem('dojo.writer')
    fireEvent.click(await screen.findByRole('button', { name: 'Build review' }))
    expect(await screen.findByText(/^Read-only/)).toBeInTheDocument()
    expect(calls.n).toBe(0)
    expect(await d.reviews.count()).toBe(0)
  })
})

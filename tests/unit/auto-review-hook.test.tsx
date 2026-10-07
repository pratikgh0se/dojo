import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DbProvider } from '../../src/data/dbContext'
import { patchSettings } from '../../src/data/db'
import { resetAutoReviewMemory, useAutoReview } from '../../src/data/useAutoReview'
import { resetNow, setNow } from '../../src/lib/clock'
import { freshDb } from '../helpers/db'

// The hook is only mounted in the shell; the syncGate is not read-only in unit tests (Dexie-only database).
function Probe() {
  useAutoReview()
  const go = useNavigate()
  return <>{['/a', '/b', '/c', '/d', '/e', '/f'].map(p => <button key={p} onClick={() => go(p)}>{p}</button>)}</>
}

beforeEach(() => resetAutoReviewMemory())
afterEach(() => resetNow())

describe('useAutoReview: a session budget of 3', () => {
  it('with 6 ended sprints, route changes and later ticks make exactly 3 AI calls, newest sprints first', async () => {
    setNow(() => new Date(2027, 0, 20, 10).getTime()) // sprint 8 of a plan that started 2026-10-05: sprints 1-7 ended
    const d = freshDb()
    await patchSettings(d, { startDate: '2026-10-05', trackedFrom: 1 })
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><DbProvider db={d}><Probe /></DbProvider></MemoryRouter>)
    await waitFor(async () => expect(await d.reviews.count()).toBe(3), { timeout: 8000 })
    for (const p of ['/a', '/b', '/c', '/d', '/e', '/f']) {
      await act(async () => { fireEvent.click(screen.getByText(p)) })
      await new Promise(r => setTimeout(r, 60))
    }
    await new Promise(r => setTimeout(r, 300))
    expect(await d.aiLog.where('job').equals('review_sprint').count()).toBe(3)
    expect((await d.reviews.toArray()).map(r => r.sprint).sort((a, b) => a - b)).toEqual([5, 6, 7])
    expect((await d.reviews.toArray()).every(r => r.kind === 'auto')).toBe(true)
  })

  it('the budget is per database: a second database in the same session still gets its own 3', async () => {
    setNow(() => new Date(2027, 0, 20, 10).getTime())
    const [a, b] = [freshDb(), freshDb()]
    for (const d of [a, b]) await patchSettings(d, { startDate: '2026-10-05', trackedFrom: 1 })
    const first = render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><DbProvider db={a}><Probe /></DbProvider></MemoryRouter>)
    await waitFor(async () => expect(await a.reviews.count()).toBe(3), { timeout: 8000 })
    first.unmount()
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><DbProvider db={b}><Probe /></DbProvider></MemoryRouter>)
    await waitFor(async () => expect(await b.reviews.count()).toBe(3), { timeout: 8000 })
    expect(await a.reviews.count()).toBe(3)
  })
})

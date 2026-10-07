// G4 M2: a smoke render of the merged Shell and Settings (ux Part 2 x briefs Part 3).
import { readFileSync } from 'node:fs'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { Shell } from '../../src/app/Shell'
import { draftBrief } from '../../src/data/briefActions'
import { patchSettings } from '../../src/data/db'
import { resetAutoReviewMemory } from '../../src/data/useAutoReview'
import { resetNow, setNow } from '../../src/lib/clock'
import { openCheck } from '../../src/lib/checkGate'
import { loadStudy, saveStudy } from '../../src/lib/studyStore'
import { startStudy } from '../../src/rules/studySession'
import { Settings } from '../../src/screens/Settings'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const NOW = ist('2026-09-22T10:00:00') // sprint 2 of a plan starting 2026-09-07: sprint 1 has ended

afterEach(() => {
  localStorage.clear()
  localStorage.setItem('dojo.writer', 'test-writer')
  resetAutoReviewMemory()
  resetNow()
})

describe('the merged Shell mounts StudyHost, roll-over, auto-review and CheckGate', () => {
  it('advances a stored study session, rolls sprint 1 over, builds its auto review and opens the check', async () => {
    setNow(() => NOW)
    const d = await seededDb()
    await patchSettings(d, { trackedFrom: 1 })
    await d.tickets.put(mkTicket({ id: 'old', title: 'Left over', sprint: 1, plannedSprint: 1, status: 'todo' }))
    await d.tickets.put(mkTicket({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps', sprint: 2, order: -1 }))
    await draftBrief(d, 'w1', NOW)
    // a focus block that ended a minute ago: the runner (StudyHost) moves it to Break and credits it
    saveStudy(startStudy({ id: 'st1', ticketId: 'w1', goal: '', cardIds: ['w1'], focusMin: 25, breakMin: 5, chime: false, now: NOW - 26 * 60_000 }))
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/board']}>
        <AppProviders db={d} plan={smallPlan}>
          <Shell />
        </AppProviders>
      </MemoryRouter>,
    )
    await waitFor(() => expect(loadStudy()).toMatchObject({ phase: 'break', blocks: 1 }), { timeout: 4000 })
    await waitFor(async () => expect((await d.events.toArray()).filter(e => e.t === 'focus')).toHaveLength(1))
    await waitFor(async () => expect((await d.tickets.get('old'))!.sprint).toBe(2), { timeout: 4000 })
    await waitFor(async () => expect((await d.reviews.toArray()).map(r => [r.sprint, r.kind])).toEqual([[1, 'auto']]), { timeout: 8000 })
    openCheck('w1')
    expect(await screen.findByRole('dialog', { name: 'Check your understanding' })).toBeInTheDocument()
  })
})

describe('the merged Settings', () => {
  it('has the Workload panel and no theme control', async () => {
    setNow(() => NOW)
    const d = await seededDb()
    renderWithApp(<Settings />, { db: d, plan: smallPlan, route: '/settings' })
    expect(await screen.findByRole('spinbutton', { name: 'Core minutes per sprint' })).toBeInTheDocument()
    expect(screen.getByText('Workload')).toBeInTheDocument()
    expect(screen.queryByText(/theme/i)).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: /theme/i })).toBeNull()
    expect(screen.queryByRole('combobox', { name: /theme/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /theme|dark|light/i })).toBeNull()
  })
})

describe('no theme styling is left behind (G4 M4)', () => {
  it('app.css has no rule for the removed More-menu theme control', () => {
    const css = readFileSync(`${process.cwd()}/src/styles/app.css`, 'utf8')
    expect(css).not.toMatch(/\.more-theme\b/)
  })
})

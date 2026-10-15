import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as chimeLib from '../../src/lib/chime'
import { Do } from '../../src/screens/Do'
import { setNow } from '../../src/lib/clock'
import { loadStudy, saveStudy } from '../../src/lib/studyStore'
import { saveTimer, TIMER_KEY } from '../../src/lib/timer'
import { startStudy } from '../../src/rules/studySession'
import { installAlgoEngines } from '../helpers/engines'
import { seededDb } from '../helpers/db'
import { flatPlanProse } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const T = new Date('2026-09-08T21:10:00+05:30').getTime()
const MIN = 60_000

async function open(id: string) {
  setNow(() => T)
  const d = await seededDb(flatPlanProse)
  renderWithApp(<Do />, { db: d, plan: flatPlanProse, route: `/do/${id}`, path: '/do/:ticketId' })
  return d
}

describe('Do screen', () => {
  it('shows the DSA statement and the invariant prompt', async () => {
    await open('p127')
    expect(await screen.findByRole('heading', { name: '127 · Word Ladder' })).toBeInTheDocument()
    expect(screen.getByText('LC 127')).toBeInTheDocument()
    expect(screen.getByText('Hard')).toBeInTheDocument()
    expect(screen.getByText('Graphs; Island (Matrix Traversal)')).toBeInTheDocument()
    expect(screen.getByLabelText('What is the invariant? What did you try?')).toBeInTheDocument()
    expect(screen.getByTestId('timer-readout')).toHaveTextContent('25:00')
  })

  it('START · PROBLEM moves the ticket to Doing and runs one persisted single session (TICKET-03)', async () => {
    const d = await open('p127')
    fireEvent.click(await screen.findByTestId('ticket-start'))
    expect(await screen.findByText('running')).toBeInTheDocument()
    expect(screen.getByTestId('timer-readout')).toHaveTextContent('25:00')
    expect((await d.tickets.get('p127'))!.status).toBe('doing')
    expect(loadStudy()).toMatchObject({ ticketId: 'p127', single: true, focusMin: 25 })
    expect(JSON.parse(localStorage.getItem(TIMER_KEY)!)).toMatchObject({ ticketId: 'p127', min: 25, running: true })
    expect(screen.queryByTestId('ticket-start')).toBeNull()
  })

  it('finish trusts a stopped timer\'s sessionStart only same-day; a stale one from an earlier day (an abandoned one) starts fresh (I1)', async () => {
    const yesterday = T - 24 * 60 * MIN
    saveTimer({ ticketId: 'p127', sessionStart: yesterday, start: yesterday, end: yesterday + 25 * MIN, min: 25, running: false, notified: false })
    const d = await open('p127')
    // Never pressed Start on the Do screen itself — finishing straight away must not inherit
    // yesterday's stopped-timer sessionStart and report a ~24h session.
    fireEvent.click(await screen.findByRole('button', { name: 'Solved' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/))
    const session = (await d.sessions.toArray())[0]
    expect(session.minutes).toBe(0)
  })

  it('an expired Do timer auto-stops so finishing next day starts a fresh session, not ~1440 minutes (N1)', async () => {
    saveTimer({ ticketId: 'p127', sessionStart: T, start: T, end: T + 25 * MIN, min: 25, running: true, notified: false })
    setNow(() => T + 26 * MIN) // still day 1, timer just expired
    const d = await seededDb(flatPlanProse)
    const first = renderWithApp(<Do />, { db: d, plan: flatPlanProse, route: '/do/p127', path: '/do/:ticketId' })
    await screen.findByText('Power up · 25 min')
    await waitFor(() => expect(JSON.parse(localStorage.getItem(TIMER_KEY)!)).toMatchObject({ running: false, notified: true }))
    first.unmount()

    setNow(() => T + 24 * 60 * MIN) // next day
    renderWithApp(<Do />, { db: d, plan: flatPlanProse, route: '/do/p127', path: '/do/:ticketId' })
    fireEvent.click(await screen.findByRole('button', { name: 'Solved' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/))
    const session = (await d.sessions.toArray())[0]
    expect(session.minutes).toBeLessThan(5)
  })

  it('a legacy timer that reaches 00:00 chimes once and says so (cu-2 P3-6)', async () => {
    saveTimer({ ticketId: 'p127', sessionStart: T, start: T, end: T + 1 * MIN, min: 1, running: true, notified: false })
    setNow(() => T + 2 * MIN)
    const chime = vi.spyOn(chimeLib, 'playChime').mockReturnValue(true)
    const d = await seededDb(flatPlanProse)
    renderWithApp(<Do />, { db: d, plan: flatPlanProse, route: '/do/p127', path: '/do/:ticketId' })
    await screen.findByText('Power up · 1 min')
    await waitFor(() => expect(JSON.parse(localStorage.getItem(TIMER_KEY)!)).toMatchObject({ running: false, notified: true }))
    expect(chime).toHaveBeenCalledTimes(1)
    expect(screen.getAllByTestId('timer-readout')).toHaveLength(1)
    chime.mockRestore()
  })

  it('no chime when the soft chime is off', async () => {
    localStorage.setItem('dojo-study-chime', 'false')
    saveTimer({ ticketId: 'p127', sessionStart: T, start: T, end: T + 1 * MIN, min: 1, running: true, notified: false })
    setNow(() => T + 2 * MIN)
    const chime = vi.spyOn(chimeLib, 'playChime').mockReturnValue(true)
    const d = await seededDb(flatPlanProse)
    renderWithApp(<Do />, { db: d, plan: flatPlanProse, route: '/do/p127', path: '/do/:ticketId' })
    await screen.findByText('Power up · 1 min')
    expect(chime).not.toHaveBeenCalled()
    chime.mockRestore()
  })

  it('a same-day timer left stopped by expiry is picked up by Do finish (N2)', async () => {
    // an expired timer is left stopped (running:false, notified:true, sessionStart kept) rather than cleared
    const sparStart = T - 50 * MIN
    saveTimer({ ticketId: 'p127', sessionStart: sparStart, start: sparStart, end: sparStart + 50 * MIN, min: 50, running: false, notified: true })
    const d = await open('p127')
    fireEvent.click(await screen.findByRole('button', { name: 'Solved' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/))
    const session = (await d.sessions.toArray())[0]
    expect(session.minutes).toBe(50)
  })

  it('resumes a running session after reload with the one reading counting down (Review Focus #3)', async () => {
    saveStudy(startStudy({ id: 'st1', ticketId: 'p127', goal: '', cardIds: ['p127'], focusMin: 25, breakMin: 5, chime: false, now: T - 5 * MIN, single: true }))
    await open('p127')
    expect(await screen.findByTestId('timer-readout')).toHaveTextContent('20:00')
    expect(screen.getByTestId('timer-state')).toHaveTextContent('running')
    expect(screen.getAllByTestId('timer-readout')).toHaveLength(1)
  })

  it('starts even when three tickets are already Doing: Doing is a soft cap', async () => {
    const d = await open('p127')
    await d.tickets.bulkUpdate([
      { key: 'm1w1t1', changes: { status: 'doing' } },
      { key: 'm1w2t1', changes: { status: 'doing', sprint: 1 } },
      { key: 'm1w3t1', changes: { status: 'doing', sprint: 1 } },
    ])
    fireEvent.click(await screen.findByTestId('ticket-start'))
    expect(await screen.findByText('running')).toBeInTheDocument()
    expect((await d.tickets.get('p127'))!.status).toBe('doing')
    expect(loadStudy()).toMatchObject({ ticketId: 'p127', single: true })
  })

  it('autosaves the attempt log', async () => {
    await open('p127')
    fireEvent.change(await screen.findByLabelText('What is the invariant? What did you try?'), { target: { value: 'bidirectional BFS' } })
    await waitFor(() => expect(localStorage.getItem('dojo-draft:p127')).toContain('bidirectional BFS'))
  })

  it('does not write a draft key while empty, and removes it once cleared (minor #8)', async () => {
    await open('p127')
    expect(localStorage.getItem('dojo-draft:p127')).toBeNull()
    const field = await screen.findByLabelText('What is the invariant? What did you try?')
    fireEvent.change(field, { target: { value: 'bidirectional BFS' } })
    await waitFor(() => expect(localStorage.getItem('dojo-draft:p127')).not.toBeNull())
    fireEvent.change(field, { target: { value: '' } })
    await waitFor(() => expect(localStorage.getItem('dojo-draft:p127')).toBeNull())
  })

  it('starting a ticket while a session runs on another saves that one and runs this one (TICKET-08)', async () => {
    const d = await open('p127')
    fireEvent.click(await screen.findByTestId('ticket-start'))
    expect(await screen.findByText('running')).toBeInTheDocument()

    renderWithApp(<Do />, { db: d, plan: flatPlanProse, route: '/do/p200', path: '/do/:ticketId' })
    fireEvent.click(await screen.findByTestId('ticket-start'))
    await waitFor(() => expect(JSON.parse(localStorage.getItem('dojo-study')!).ticketId).toBe('p200'))
    expect(screen.queryByText('A session is running on another ticket; end it first.')).toBeNull()
    expect((await d.tickets.get('p200'))!.status).toBe('doing')
    expect((await d.sessions.toArray()).some(x => x.ticketId === 'p127' && x.outcome === 'studied')).toBe(true)
  })

  it('Solved closes the session and pays XP, then stays to ask which approach (labs §7.3)', async () => {
    const d = await open('p127')
    fireEvent.click(await screen.findByTestId('ticket-start'))
    await screen.findByText('running')
    fireEvent.click(screen.getByRole('button', { name: 'Solved' }))
    await screen.findByRole('group', { name: 'Which approach did you use?' })
    expect(await d.tickets.get('p127')).toMatchObject({ status: 'done', xp: 15 })
    expect(await d.sessions.count()).toBe(1)
    expect(localStorage.getItem(TIMER_KEY)).toBeNull()
    expect(loadStudy()).toBeNull()
    expect(screen.getByText('+15 xp · Saved')).toBeInTheDocument()
  })

  it('shows the Approaches strip brute → best, nothing open, and opens a library picture free (labs §7.1, S40)', async () => {
    installAlgoEngines()
    const d = await open('p200')
    const strip = await screen.findByRole('region', { name: 'Approaches' })
    const chips = within(strip).getAllByTestId('dsa-approach-chip')
    expect(chips.map(c => c.getAttribute('aria-label'))).toEqual(['Union-find · O(m·n·α)', 'BFS flood fill · O(m·n)', 'DFS flood fill · O(m·n) · best'])
    expect(chips.map(c => c.getAttribute('data-library-key'))).toEqual(['dsu', 'bfsGrid', 'islands'])
    expect(within(strip).queryByTestId('lab-player')).toBeNull()
    fireEvent.click(chips[2])
    expect(await within(strip).findByRole('region', { name: 'Player: Flood fill · number of islands' })).toBeInTheDocument()
    expect(chips[2]).toHaveAttribute('aria-pressed', 'true')
    expect(within(strip).getByTestId('lab-step-counter')).toHaveTextContent('STEP 0 / 15')
    expect(await d.events.count()).toBe(0)
  })

  it('Pick two opens a two-up with the first pick on the left (labs §7.2, S41)', async () => {
    installAlgoEngines()
    await open('p200')
    const strip = await screen.findByRole('region', { name: 'Approaches' })
    fireEvent.click(within(strip).getByRole('button', { name: 'Pick two' }))
    expect(within(strip).getByRole('button', { name: 'Pick two' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(strip).getByRole('button', { name: 'BFS flood fill · O(m·n)' }))
    fireEvent.click(within(strip).getByRole('button', { name: 'Union-find · O(m·n·α)' }))
    const two = await within(strip).findByRole('region', { name: 'Two-up' })
    await waitFor(() => expect(within(two).getAllByTestId('lab-player').map(p => p.getAttribute('data-walkthrough'))).toEqual(['bfsGrid', 'dsu']))
    expect(within(strip).getByRole('button', { name: 'Pick two' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('Do two-up "Compare with" swaps the right player, like Atlas\'s two-up (review bug)', async () => {
    installAlgoEngines()
    await open('p200')
    const strip = await screen.findByRole('region', { name: 'Approaches' })
    fireEvent.click(within(strip).getByRole('button', { name: 'Pick two' }))
    fireEvent.click(within(strip).getByRole('button', { name: 'BFS flood fill · O(m·n)' }))
    fireEvent.click(within(strip).getByRole('button', { name: 'Union-find · O(m·n·α)' }))
    await within(strip).findByRole('region', { name: 'Two-up' })
    const two = () => within(strip).getByRole('region', { name: 'Two-up' })
    await waitFor(() => expect(within(two()).getAllByTestId('lab-player').map(p => p.getAttribute('data-walkthrough'))).toEqual(['bfsGrid', 'dsu']))

    fireEvent.change(within(two()).getByRole('combobox', { name: 'Compare with' }), { target: { value: 'islands' } })

    await waitFor(() => expect(within(two()).getAllByTestId('lab-player').map(p => p.getAttribute('data-walkthrough'))).toEqual(['bfsGrid', 'islands']))
    expect(within(two()).getByRole('combobox', { name: 'Compare with' })).toHaveValue('islands')
  })

  it('asks which approach he used after Solved with help, stores it, and lets him change it (labs §7.3)', async () => {
    const d = await open('p200')
    fireEvent.click(await screen.findByRole('button', { name: 'Solved with help' }))
    const q = await screen.findByRole('group', { name: 'Which approach did you use?' })
    expect(within(q).getAllByRole('button').map(b => b.textContent)).toEqual(['Union-find · O(m·n·α)', 'BFS flood fill · O(m·n)', 'DFS flood fill · O(m·n) · best', 'Other', 'Back to Today'])
    fireEvent.click(within(q).getByRole('button', { name: 'BFS flood fill · O(m·n)' }))
    expect(within(q).getByRole('button', { name: 'BFS flood fill · O(m·n)' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(async () => expect((await d.sessions.toArray()).map(s => [s.outcome, s.approach])).toEqual([['solved_help', 'bfs']]))
    fireEvent.click(within(q).getByRole('button', { name: 'Other' }))
    await waitFor(async () => expect((await d.sessions.toArray())[0].approach).toBe('other'))
  })

  it('never asks on Give up, nor for a problem without approaches (D-16)', async () => {
    const d = await open('p1')
    expect(await screen.findByRole('region', { name: 'Approaches' })).toHaveTextContent('No approaches listed yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Solved' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/))
    expect((await d.sessions.toArray())[0].approach).toBeUndefined()
  })

  it('Give up never asks which approach: stays on the ladder\'s own given-up state', async () => {
    await open('p200')
    fireEvent.click(await screen.findByRole('button', { name: 'Give up' }))
    await screen.findByTestId('do-given-up')
    expect(screen.queryByTestId('dsa-approach-used')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Which approach did you use?' })).toBeNull()
  })

  it('Space starts the session, then pauses and resumes it (UAT J3), and Escape leaves', async () => {
    await open('p127')
    await screen.findByTestId('ticket-start')
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(await screen.findByText('running')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(await screen.findByText('paused')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(await screen.findByText('running')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })

  it('says an unknown ticket is not on the path, with one way on (TICKET-02)', async () => {
    await open('nope')
    expect(await screen.findByText('That ticket is not on your path.')).toBeInTheDocument()
    expect(screen.getByTestId('ticket-missing-action')).toHaveAttribute('href', '/path')
    expect(screen.getByTestId('do-back')).toHaveTextContent('Back')
  })
})

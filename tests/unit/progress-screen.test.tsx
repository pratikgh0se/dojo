import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { moveTicket } from '../../src/data/boardActions'
import { setNow } from '../../src/lib/clock'
import { Progress } from '../../src/screens/Progress'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// smallPlan: 10 tickets (AI 3, interview 7 of which 3 problems and 2 designs); start 2026-09-07.
const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const S1 = ist('2026-09-08T10:00:00')

async function setup(at = S1) {
  setNow(() => at)
  const d = await seededDb()
  renderWithApp(<Progress />, { db: d, plan: smallPlan, route: '/progress', path: '/progress' })
  await screen.findByTestId('ring-all')
  return d
}

describe('Progress screen', () => {
  it('shows five rings with live counts', async () => {
    const d = await setup()
    expect(screen.getByTestId('ring-all-count')).toHaveTextContent('0/10')
    expect(screen.getByTestId('ring-ai-count')).toHaveTextContent('0/3')
    expect(screen.getByTestId('ring-interview-count')).toHaveTextContent('0/7')
    expect(screen.getByTestId('ring-dsa-count')).toHaveTextContent('0/3')
    expect(screen.getByTestId('ring-designs-count')).toHaveTextContent('0/2')
    await moveTicket(d, 'p127', 'done', S1)
    await waitFor(() => expect(screen.getByTestId('ring-dsa-count')).toHaveTextContent('1/3'))
    expect(screen.getByTestId('pace-hard')).toHaveTextContent('1')
  })

  it('UAT r2 J3: the pace sentence counts each card once (AI + Interview, as the ALL ring); DSA and Designs are part of Interview', async () => {
    const d = await setup()
    await moveTicket(d, 'p127', 'done', S1)
    await waitFor(() => expect(screen.getByTestId('ring-all-count')).toHaveTextContent('1/10'))
    expect(screen.getByTestId('pace-text')).toHaveTextContent(/; you have 1\./)
    expect(screen.getByTestId('pace-text')).toHaveTextContent('across AI and Interview (DSA and Designs are part of Interview)')
  })

  it('draws the burn-up with a NOW marker inside the plan window', async () => {
    await setup()
    expect(screen.getByRole('img', { name: 'Planned vs done, cumulative by sprint' })).toBeInTheDocument()
    expect(document.querySelectorAll('[data-marker="now"]')).toHaveLength(1)
    expect(screen.queryByTestId('burn-before')).toBeNull()
  })

  it('before start: plan line only, no NOW marker, no projection (Review Focus #5)', async () => {
    await setup(ist('2026-09-01T10:00:00'))
    expect(screen.getByTestId('burn-before')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-marker="now"]')).toHaveLength(0)
    expect(screen.getByTestId('pace-finish')).toHaveTextContent('—')
  })

  it('a session with no solved / gave-up outcome shows a plain line, not an empty chart box (cu-r1 P3-10)', async () => {
    const d = await setup()
    await d.sessions.add({ id: 'st', ticketId: 'p200', start: S1, end: S1 + 900_000, minutes: 15, outcome: 'studied', xpDelta: 0 })
    await waitFor(() => expect(screen.getByTestId('no-outcomes')).toBeInTheDocument())
    expect(screen.queryByRole('img', { name: 'Session outcomes per sprint' })).toBeNull()
  })

  it('reports pace verdicts against the plan', async () => {
    await setup(ist('2026-09-21T10:00:00')) // S2: one AI ticket was planned in S1
    expect(screen.getByTestId('pace-ai')).toHaveTextContent('Behind')
    expect(screen.getByTestId('pace-designs')).toHaveTextContent('On pace')
  })

  it('says "No sessions yet" until a session exists, then charts outcomes', async () => {
    const d = await setup()
    expect(screen.getByTestId('no-sessions')).toHaveTextContent('No sessions yet')
    await d.sessions.add({ id: 's1', ticketId: 'p200', start: S1, end: S1 + 25 * 60_000, minutes: 25, outcome: 'solved', xpDelta: 10 })
    await waitFor(() => expect(screen.queryByTestId('no-sessions')).toBeNull())
    // p200 is not done, so the session is no counted outcome yet: a plain line, not an empty chart box (cu-r1 P3-10)
    expect(screen.getByTestId('no-outcomes')).toBeInTheDocument()
    // ruling 24 S3: "Focus hours" counts the logged focus blocks; a 25-minute attempt is not focus
    expect(screen.getByTestId('pace-hours')).toHaveTextContent('0 h')
    await d.events.add({ t: 'focus', id: 'p200', at: S1 + 25 * 60_000, minutes: 25 })
    await waitFor(() => expect(screen.getByTestId('pace-hours')).toHaveTextContent(/^25 min$/)) // under an hour it is minutes, as Today and Week say it (UAT cu-2p P3-3)
    expect(screen.getByText('Focus hours')).toBeInTheDocument()
    expect(screen.queryByText('Hours in')).toBeNull()
  })

  it('an unticked card takes its green "Solved" bar with it; ticked again, it is back (cu-2 P3-16)', async () => {
    const d = await setup()
    const solved = () => [...document.querySelectorAll('[data-series="solved"]')].reduce((a, r) => a + Number(r.getAttribute('data-value')), 0)
    await d.sessions.add({ id: 's1', ticketId: 'p200', start: S1, end: S1 + 25 * 60_000, minutes: 25, outcome: 'solved', xpDelta: 10 })
    await d.tickets.update('p200', { status: 'done', doneAt: S1 + 25 * 60_000 })
    await waitFor(() => expect(solved()).toBe(1))
    await d.tickets.update('p200', { status: 'todo', doneAt: undefined })
    await waitFor(() => expect(solved()).toBe(0))
    await d.tickets.update('p200', { status: 'done', doneAt: S1 + 30 * 60_000 })
    await waitFor(() => expect(solved()).toBe(1))
  })

  it('shows 12 stage badges (Stage 00–11, testids badge-00…badge-11), none cleared on a plan with no stage tickets', async () => {
    await setup()
    const badges = document.querySelectorAll('[data-testid^="badge-"]')
    expect(badges).toHaveLength(12)
    expect([...badges].map(b => b.getAttribute('data-testid'))).toEqual(Array.from({ length: 12 }, (_, i) => `badge-${String(i).padStart(2, '0')}`))
    expect(screen.getByTestId('badge-00')).toHaveTextContent('00')
    expect(screen.getByTestId('badge-05')).toHaveTextContent('05')
    expect(screen.getByTestId('badge-11')).toHaveTextContent('11')
    expect([...badges].every(b => !b.classList.contains('on'))).toBe(true)
  })
})

describe('Progress: study sessions (ux spec end log)', () => {
  it('labels what each length is: the session\'s own clock time, and the focus minutes in it (ruling 24 S3)', async () => {
    const d = await setup()
    await d.sessions.add({
      id: 'sl', ticketId: 'p127', start: S1 - 1_800_000, end: S1 - 900_000, minutes: 15, focusMinutes: 4, outcome: 'studied', xpDelta: 0,
      endLog: { done: 'x', stuckOn: '', nextStep: '' },
    })
    await d.sessions.add({
      id: 'so', ticketId: 'p127', start: S1 - 7_200_000, end: S1 - 6_300_000, minutes: 15, outcome: 'studied', xpDelta: 0,
      endLog: { done: 'y', stuckOn: '', nextStep: '' },
    })
    const len = async (id: string) => (await within(await screen.findByTestId(`study-session-${id}`)).findByTestId('study-length')).textContent
    expect(await len('sl')).toBe('15 min session · 4 min focus')
    expect(await len('so')).toBe('15 min session') // an older row never kept its focus minutes: the length only
  })

  it('lists a study session with its Done / Stuck on / Next step texts, newest first, and says so when there are none', async () => {
    const d = await setup()
    expect(screen.getByTestId('no-study-sessions')).toHaveTextContent('No study sessions yet')
    await d.sessions.add({
      id: 'sa', ticketId: 'p127', start: S1 - 3_600_000, end: S1 - 3_000_000, minutes: 10, outcome: 'studied', xpDelta: 0,
      goal: 'older', endLog: { done: 'older done', stuckOn: '', nextStep: '' },
    })
    await d.sessions.add({
      id: 'sb', ticketId: 'p127', start: S1 - 1_800_000, end: S1 - 600_000, minutes: 20, outcome: 'studied', xpDelta: 0,
      goal: 'trace it', endLog: { done: 'the loop', stuckOn: 'the queue order', nextStep: 'edge cases' },
    })
    const item = await screen.findByTestId('study-session-sb')
    expect(item).toHaveTextContent('Done: the loop')
    expect(item).toHaveTextContent('Stuck on: the queue order')
    expect(item).toHaveTextContent('Next step: edge cases')
    expect(item).toHaveTextContent('Word Ladder')
    expect(item).toHaveTextContent('20 min')
    expect(screen.getByTestId('study-session-sa')).not.toHaveTextContent('Stuck on')
    const order = screen.getAllByTestId(/^study-session-s/).map(e => e.getAttribute('data-testid'))
    expect(order).toEqual(['study-session-sb', 'study-session-sa'])
    expect(screen.queryByTestId('no-study-sessions')).toBeNull()
  })

  it('P1 #5: shows the 10 newest, then "Show all (n)" reveals the rest (triage A2)', async () => {
    const d = await setup()
    // one write: added one by one, the list could render st00 while only some of the 11 existed (a flaky count)
    await d.sessions.bulkAdd(Array.from({ length: 11 }, (_, i) => ({
      id: `st${String(i).padStart(2, '0')}`, ticketId: 'p127', start: S1 - (i + 2) * 3_600_000, end: S1 - (i + 1) * 3_600_000,
      minutes: 10, outcome: 'studied' as const, xpDelta: 0, endLog: { done: `done ${i}`, stuckOn: '', nextStep: '' },
    })))
    await screen.findByTestId('study-session-st00')
    expect(screen.getAllByTestId(/^study-session-st/)).toHaveLength(10)
    expect(screen.queryByTestId('study-session-st10')).toBeNull()
    const more = screen.getByRole('button', { name: 'Show all (11)' })
    fireEvent.click(more)
    expect(screen.getAllByTestId(/^study-session-st/)).toHaveLength(11)
    expect(screen.getByTestId('study-session-st10')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull()
  })
  it('no "Show all" button at 10 or fewer sessions', async () => {
    const d = await setup()
    await d.sessions.add({ id: 'only', ticketId: 'p127', start: S1 - 7_200_000, end: S1 - 3_600_000, minutes: 10, outcome: 'studied', xpDelta: 0, endLog: { done: 'x', stuckOn: '', nextStep: '' } })
    await screen.findByTestId('study-session-only')
    expect(screen.queryByRole('button', { name: /^Show all/ })).toBeNull()
  })
})

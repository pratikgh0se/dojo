import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fakeOutput } from '../../src/ai/fake'
import type { DiagramJson, SolutionOutput } from '../../src/ai/types'
import { draftBrief } from '../../src/data/briefActions'
import type { DojoDB } from '../../src/data/db'
import { setNow } from '../../src/lib/clock'
import { loadCycle } from '../../src/lib/cycle'
import { saveTimer } from '../../src/lib/timer'
import { CheckGate } from '../../src/screens/brief/CheckGate'
import { Do } from '../../src/screens/Do'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

vi.mock('../../src/ui/algo/AlgoPlayer', () => ({
  AlgoPlayer: ({ json, record }: { json: { title: string; steps: unknown[] }; record?: boolean }) => (
    <section data-testid="lab-player" aria-label={`Player: ${json.title}`} data-walkthrough="picture" data-steps={json.steps.length} data-record={String(record)} />
  ),
}))

const T = new Date('2026-09-08T21:10:00+05:30').getTime()
const MIN = 60_000
const DAY = 24 * 60 * MIN
const NAMES = ['attempt', 'hint', 'picture', 'video', 'solution']

function timerFrom(id: string, start: number) {
  saveTimer({ ticketId: id, sessionStart: start, start, end: start + 25 * MIN, min: 25, running: true, notified: false })
}
async function open(id: string, opts: { d?: DojoDB; at?: number } = {}) {
  setNow(() => opts.at ?? T)
  const d = opts.d ?? (await seededDb())
  const view = renderWithApp(<Do />, { db: d, plan: smallPlan, route: `/do/${id}`, path: '/do/:ticketId' })
  await screen.findByTestId('ladder')
  return { d, view }
}
const rung = (n: string) => screen.getByTestId(`ladder-rung-${n}`)
const spent = () => screen.getByTestId('ladder-spent').getAttribute('data-xp')
async function openRung(n: string, total: string) {
  fireEvent.click(screen.getByTestId(`ladder-open-${n}`))
  await waitFor(() => expect(spent()).toBe(total))
}

describe('Do ladder', () => {
  it('H-01 initial DSA ladder and the Do test ids', async () => {
    await open('p200')
    expect(screen.getByRole('main')).toHaveAttribute('data-testid', 'do-screen')
    expect(screen.getByTestId('do-title')).toHaveTextContent('200 · Number of Islands')
    expect(screen.getByTestId('do-back')).toHaveAccessibleName('‹ Back')
    expect(screen.getByTestId('do-timer-preset-25')).toHaveAccessibleName('Start 25 min')
    expect(screen.getByTestId('do-timer-preset-50')).toHaveAccessibleName('Start 50 min')
    expect(screen.getByTestId('do-timer-elapsed')).toHaveAttribute('data-seconds', '0')
    expect(screen.getByTestId('do-attempt-log')).toHaveAccessibleName('What is the invariant? What did you try?')
    expect(screen.getByTestId('do-ticket-xp')).toHaveTextContent('Net 0 xp')
    expect(NAMES.map(n => rung(n).dataset.state)).toEqual(['open', 'locked', 'locked', 'locked', 'locked'])
    expect(NAMES.map(n => rung(n).dataset.cost)).toEqual(['0', '2', '3', '3', '5'])
    expect(screen.getByTestId('do-outcome-solved')).toBeEnabled()
    expect(screen.getByTestId('do-outcome-help')).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('redo-banner')).toBeNull()
  })

  it('C-INT I-01 DSA Picture opens the labs player, recording off', async () => {
    timerFrom('p200', T - 10 * MIN)
    await open('p200')
    await openRung('hint', '2')
    await openRung('picture', '5')
    const fig = screen.getByTestId('ladder-picture-player')
    expect(fig).toHaveAttribute('data-steps', '15')
    const player = within(fig).getByTestId('lab-player')
    expect(player).toHaveAccessibleName('Player: [fake:picture] Max scan for p200')
    expect(player).toHaveAttribute('data-record', 'false')
  })

  it('H-06/H-16 Hint charges 2, announces Picture, forces Solved with help (+8, help tone, no redo)', async () => {
    timerFrom('p200', T - 10 * MIN)
    const { d } = await open('p200')
    expect(screen.getByTestId('do-timer-elapsed')).toHaveAttribute('data-seconds', '600')
    expect(screen.getByTestId('ladder-open-hint')).toHaveAccessibleName('Open Hint, costs 2 xp')
    await openRung('hint', '2')
    expect(screen.getByTestId('ladder-hint-1').textContent).toMatch(/^\[fake:hint\].*p200/)
    expect(rung('hint').dataset.state).toBe('open')
    expect(screen.getByTestId('ladder-why-hint').textContent).toBe('Why did I pay for this? Hint cost 2 xp.')
    expect(screen.getByTestId('ladder-announcer')).toHaveTextContent('Picture unlocked, costs 3 xp')
    expect(screen.getByTestId('do-outcome-solved')).toBeDisabled()
    expect(screen.getByTestId('do-outcome-help')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('do-outcome-help'))
    // p200 has approaches (labs §7.3, D-16): Solved/Solved with help stays to ask which one, rather than
    // navigating straight to the Board; "Back to Board" (I4) is what actually leaves.
    await screen.findByTestId('dsa-approach-used')
    fireEvent.click(screen.getByRole('button', { name: 'Back to Board' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/board'))
    expect(screen.getByTestId('toast')).toHaveTextContent('+8 xp · Saved')
    expect(screen.getByTestId('toast')).toHaveAttribute('data-tone', 'help')
    expect((await d.tickets.get('p200'))!.xp).toBe(8)
    expect(await d.redos.count()).toBe(0)
  })

  it('Addendum 11: on a briefed learning card, Hint disables Solved ✓ and Solved with help opens the check', async () => {
    timerFrom('w1', T - 10 * MIN)
    const d = await seededDb()
    await d.tickets.put(mkTicket({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps', sprint: 1, order: -1, status: 'doing' }))
    await draftBrief(d, 'w1', T)
    setNow(() => T)
    renderWithApp(<><Do /><CheckGate /></>, { db: d, plan: smallPlan, route: '/do/w1', path: '/do/:ticketId' })
    await screen.findByTestId('ladder')
    expect(screen.getByTestId('do-outcome-solved')).toBeEnabled()
    await openRung('hint', '2')
    expect(screen.getByTestId('do-outcome-solved')).toBeDisabled()
    fireEvent.click(screen.getByTestId('do-outcome-help'))
    expect(await screen.findByRole('dialog', { name: 'Check your understanding' })).toBeInTheDocument()
  })

  it('H-14 Solved ✓ without help: +10, ok tone, flash', async () => {
    const flashes = Number(document.documentElement.dataset.flashes ?? '0')
    await open('p200')
    fireEvent.click(screen.getByTestId('do-outcome-solved'))
    await screen.findByTestId('dsa-approach-used')
    fireEvent.click(screen.getByRole('button', { name: 'Back to Board' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/board'))
    expect(screen.getByTestId('toast')).toHaveTextContent('+10 xp · Saved')
    expect(screen.getByTestId('toast')).toHaveAttribute('data-tone', 'ok')
    expect(Number(document.documentElement.dataset.flashes)).toBe(flashes + 1)
  })

  it('H-09/H-11 Give up stays on Do, schedules the redo, unlocks Solution; a 2/3 quiz marks the session understood', async () => {
    const { d } = await open('p200')
    fireEvent.click(screen.getByTestId('do-outcome-giveup'))
    expect(await screen.findByTestId('do-given-up')).toHaveTextContent('Given up · redo due Sep 11')
    expect(screen.getByTestId('toast')).toHaveTextContent('Logged. Redo in 3 days.')
    expect(screen.getByTestId('location')).toHaveTextContent('/do/p200')
    expect(screen.getByTestId('ladder-open-solution')).toHaveAccessibleName('Open Solution, costs 5 xp')
    expect(screen.getByTestId('ladder-announcer')).toHaveTextContent('Solution unlocked, costs 5 xp')
    expect(screen.getByTestId('do-outcome-giveup')).toBeDisabled()
    await openRung('solution', '5')
    expect(screen.getByTestId('ladder-solution').textContent).toMatch(/^\[fake:solution\].*p200/)
    const quiz = (fakeOutput('solution', { ticket: { id: 'p200', title: 'x', track: 'dsa' }, context: { gave_up: true } } as never) as SolutionOutput).quiz
    fireEvent.change(screen.getByTestId('ladder-quiz-answer-1'), { target: { value: `  ${quiz[0].a.toUpperCase()}. ` } })
    fireEvent.change(screen.getByTestId('ladder-quiz-answer-2'), { target: { value: quiz[1].a } })
    fireEvent.change(screen.getByTestId('ladder-quiz-answer-3'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByTestId('ladder-quiz-check'))
    expect(await screen.findByTestId('ladder-quiz-result')).toHaveTextContent('Understood · 2/3')
    const [s] = await d.sessions.toArray()
    await waitFor(async () => expect((await d.sessions.get(s.id))!.understood).toBe(true))
    expect(await d.redos.toArray()).toMatchObject([{ ticketId: 'p200', stage: 0, helpCost: 5 }])
  })

  it('H-24 a remount after Give up keeps the given-up state', async () => {
    const { d, view } = await open('p200')
    fireEvent.click(screen.getByTestId('do-outcome-giveup'))
    await screen.findByTestId('do-given-up')
    view.unmount()
    await open('p200', { d, at: T + MIN })
    expect(screen.getByTestId('do-given-up')).toHaveTextContent('Given up · redo due Sep 11')
    expect(rung('solution').dataset.state).toBe('unlocked')
  })

  it('H-44 a failed Hint charges nothing, keeps Solved ✓ enabled, and Retry recovers', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'hint:claude_missing')
    timerFrom('p200', T - 10 * MIN)
    await open('p200')
    fireEvent.click(screen.getByTestId('ladder-open-hint'))
    expect(await screen.findByTestId('ai-error')).toHaveTextContent('Claude Code is not installed or not on PATH.')
    expect(screen.getByTestId('ai-error-detail').textContent).toMatch(/^claude_missing:/)
    expect(rung('hint').dataset.state).toBe('unlocked')
    expect(rung('picture').dataset.state).toBe('locked')
    expect(spent()).toBe('0')
    expect(screen.getByTestId('do-outcome-solved')).toBeEnabled()
    localStorage.removeItem('dojo-ai-fake-fail')
    fireEvent.click(screen.getByTestId('ai-retry'))
    expect(await screen.findByTestId('ladder-hint-1')).toBeInTheDocument()
    await waitFor(() => expect(spent()).toBe('2'))
  })

  it('Review Focus 1: a second activation while the hint is loading does not charge twice', async () => {
    localStorage.setItem('dojo-ai-fake-delay-ms', '50')
    timerFrom('p200', T - 10 * MIN)
    const { d } = await open('p200')
    const b = screen.getByTestId('ladder-open-hint')
    fireEvent.click(b)
    fireEvent.click(b)
    await screen.findByTestId('ladder-hint-1')
    await waitFor(() => expect(spent()).toBe('2'))
    expect(await d.rungUses.count()).toBe(1)
  })

  it('H-20/H-22 a remount keeps the cycle and shows stored outputs even when the AI fails', async () => {
    timerFrom('p200', T - 10 * MIN)
    const { d, view } = await open('p200')
    await openRung('hint', '2')
    view.unmount()
    localStorage.setItem('dojo-ai-fake-fail', '*')
    await open('p200', { d, at: T + MIN })
    expect(screen.getByTestId('ladder-hint-1').textContent).toMatch(/^\[fake:hint\]/)
    expect(spent()).toBe('2')
    expect(screen.getByTestId('do-outcome-solved')).toBeDisabled()
    expect(screen.queryByTestId('ai-error')).toBeNull()
  })

  it('H-23 the next cycle relocks every rung and reuses the stored hint with no model call', async () => {
    timerFrom('p200', T - 10 * MIN)
    const first = await open('p200')
    await openRung('hint', '2')
    fireEvent.click(screen.getByTestId('do-outcome-help'))
    await screen.findByTestId('dsa-approach-used')
    fireEvent.click(screen.getByRole('button', { name: 'Back to Board' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/board'))
    first.view.unmount()
    const next = await open('p200', { d: first.d, at: T + DAY })
    expect(NAMES.map(n => rung(n).dataset.state)).toEqual(['open', 'locked', 'locked', 'locked', 'locked'])
    expect(spent()).toBe('0')
    next.view.unmount()
    timerFrom('p200', T + DAY + MIN)
    localStorage.setItem('dojo-ai-fake-fail', 'hint')
    await open('p200', { d: first.d, at: T + DAY + 11 * MIN })
    await openRung('hint', '2')
    expect(screen.getByTestId('ladder-hint-1').textContent).toMatch(/^\[fake:hint\]/)
    expect(screen.queryByTestId('ai-error')).toBeNull()
  })

  it('H-23-regression: a stale timer-expiry effect during the labs "asking" detour does not resurrect the closed cycle', async () => {
    // Root cause: finish() cleared the cycle/timer from storage but never nulled the matching React
    // state. Before the labs merge that was harmless - Solved/Solved with help always navigated away
    // immediately, unmounting Do and killing the timer-expiry effect with it. The merge added the
    // "which approach did you use?" detour (labs §7.3), which keeps Do mounted after Solved on a
    // problem with approaches (p200 has some). If the timer's original end time then passes while
    // still on that screen, the timer-expiry effect fires with the stale closed-over `cycle`/`timer`
    // and its bank() call writes that stale cycle straight back into storage - so a fresh cycle
    // opened later (e.g. next day) wrongly inherits it instead of starting locked (black-box H-23).
    timerFrom('p200', T - 10 * MIN) // 25 min timer, started 10 min ago: still running, expires at T+15min
    const first = await open('p200')
    await openRung('hint', '2')
    fireEvent.click(screen.getByTestId('do-outcome-help'))
    await screen.findByTestId('dsa-approach-used') // stayed on the ladder screen to ask (D-16)
    expect(loadCycle('p200')).toBeNull() // finish() already closed the cycle in storage
    // finish() must drop the React timer state too, not just storage, or the ladder screen's own
    // timer readout would keep showing the closed session's countdown while "asking" is up.
    expect(screen.getByTestId('timer-readout')).toHaveTextContent('--:--')

    // Stay mounted (no Back to Board, no unmount) and let the original timer's end time pass -
    // real wall-clock time, so useNow's setInterval(1000ms) actually ticks and re-renders.
    setNow(() => T + 16 * MIN)
    await new Promise(resolve => setTimeout(resolve, 1200))
    expect(screen.queryByText('Power up · 25 min')).toBeNull() // the stale timer-expiry effect must not fire
    expect(loadCycle('p200')).toBeNull() // ... and must not have resurrected the closed cycle

    first.view.unmount()
    const next = await open('p200', { d: first.d, at: T + DAY })
    expect(NAMES.map(n => rung(n).dataset.state)).toEqual(['open', 'locked', 'locked', 'locked', 'locked'])
    expect(spent()).toBe('0')
    next.view.unmount()
  })

  it('H-12/I-06 design Picture draws the reference diagram; Video lists the refs', async () => {
    timerFrom('d-method', T - 10 * MIN)
    await open('d-method')
    await openRung('hint', '3')
    await openRung('picture', '7')
    const dia = fakeOutput('diagram', { ticket: { id: 'd-method', title: 'x', track: 'design' }, context: { deepDives: [] } } as never) as DiagramJson
    const fig = screen.getByRole('figure', { name: 'Picture for The method, on a whiteboard, in 45 minutes' })
    expect(fig).toHaveAttribute('data-nodes', String(dia.nodes.length))
    expect(fig).toHaveTextContent(`Reference architecture · ${dia.nodes.length} nodes · ${dia.links.length} links`)
    expect(within(fig).getByTestId('ladder-picture-diagram')).toHaveAccessibleName('Reference architecture for The method, on a whiteboard, in 45 minutes')
    expect(within(within(fig).getByRole('list', { name: 'Nodes' })).getAllByRole('listitem').map(li => li.textContent)).toEqual(dia.nodes.map(n => n.label ?? n.id))
    await openRung('video', '10')
    expect(within(screen.getByTestId('ladder-video-links')).getByRole('link', { name: 'Hello Interview free guides' })).toHaveAttribute('target', '_blank')
  })

  it('H-13 task Picture lists the paired watch links with no AI; Video reads No video, costs 0, no why-line', async () => {
    const d = await seededDb()
    await d.tickets.bulkPut([
      mkTicket({ id: 'stage-00-x-w1-watch', kind: 'stage', title: 'Watch', links: [{ label: '3Blue1Brown calculus', url: 'https://www.3blue1brown.com/topics/calculus' }] }),
      mkTicket({ id: 'stage-00-x-w1-rebuild', kind: 'stage', title: 'Rebuild', links: [] }),
    ])
    timerFrom('stage-00-x-w1-rebuild', T - 10 * MIN)
    await open('stage-00-x-w1-rebuild', { d })
    expect(NAMES.slice(0, 4).map(n => rung(n).dataset.cost)).toEqual(['0', '2', '2', '0'])
    expect(rung('solution').dataset.state).toBe('na')
    await openRung('hint', '2')
    localStorage.setItem('dojo-ai-fake-fail', '*')
    await openRung('picture', '4')
    expect(within(rung('picture')).getByRole('link', { name: '3Blue1Brown calculus' })).toBeInTheDocument()
    expect(screen.queryByTestId('ai-error')).toBeNull()
    fireEvent.click(screen.getByTestId('ladder-open-video'))
    await waitFor(() => expect(rung('video').dataset.state).toBe('open'))
    expect(rung('video')).toHaveTextContent('No video for this task')
    expect(spent()).toBe('4')
    expect(screen.queryByTestId('ladder-why-video')).toBeNull()
  })

  it('H-27/H-28 a due redo is a redo session: banner, doubled costs; Solved ✓ refunds floor(C/2)', async () => {
    const d = await seededDb()
    await d.rungUses.put({ id: 'u0', ticketId: 'p200', attemptStart: T - 3 * DAY, cycleId: 'old-cyc', rung: 5, at: T - 3 * DAY, cost: 10, applied: 10, refunded: 0 })
    await d.redos.put({ id: 'r1', ticketId: 'p200', source: 'gave_up', createdAt: T - 3 * DAY, stage: 0, due: T - MIN, passed: [], helpCost: 10, refunded: 0 })
    await open('p200', { d })
    const banner = screen.getByTestId('redo-banner')
    expect(banner).toHaveTextContent('Redo · stage 1 of 3 · Picture, Video and Solution cost double')
    expect(banner).toHaveAttribute('data-stage', '0')
    expect(NAMES.map(n => rung(n).dataset.cost)).toEqual(['0', '2', '6', '6', '10'])
    fireEvent.click(screen.getByTestId('do-outcome-solved'))
    await screen.findByTestId('dsa-approach-used')
    fireEvent.click(screen.getByRole('button', { name: 'Back to Board' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/board'))
    expect(screen.getByTestId('toast')).toHaveTextContent('+5 xp refunded')
    expect((await d.tickets.get('p200'))!.xp).toBe(5)
    expect(await d.redos.get('r1')).toMatchObject({ stage: 1 })
  })

  it('Review Focus 2: a stale empty cycle from yesterday is replaced so a newly due redo counts', async () => {
    const d = await seededDb()
    const first = await open('p200', { d, at: T - DAY })
    first.view.unmount()
    await d.redos.put({ id: 'r1', ticketId: 'p200', source: 'gave_up', createdAt: T - 3 * DAY, stage: 0, due: T - MIN, passed: [], helpCost: 10, refunded: 0 })
    await open('p200', { d, at: T })
    expect(screen.getByTestId('redo-banner')).toBeInTheDocument()
  })

  it('H-32-regression: a fresh cycle never inherits an earlier cycle\'s rung uses, even when it repeats the same attemptStart (I3)', async () => {
    // Root cause of the H-32 black-box failure: rungUses used to key off `attemptStart` alone to
    // say which cycle they belong to. A frozen/adjusted wall clock could hand two distinct cycles
    // the exact same `now()` reading, so the new cycle would silently "inherit" the old cycle's
    // uses via that shared timestamp, and a later stale check would miscount it as "still has
    // uses" and refuse to replace it with a redo session — the due redo's row opens the ticket but
    // the redo banner never shows. Fixed by keying rungUses off a real cycle id (RungUse.cycleId,
    // Cycle.id - always unique via newId()) instead: reproduced here by seeding an old, closed
    // cycle's rung uses that happen to share attemptStart T with the cycle the next open() call
    // will create, and confirming the new cycle's ladder starts empty regardless.
    const d = await seededDb()
    await d.rungUses.bulkPut([
      { id: 'u0', ticketId: 'p200', attemptStart: T, cycleId: 'old-cyc', rung: 2, at: T, cost: 2, applied: 0, refunded: 0 },
      { id: 'u1', ticketId: 'p200', attemptStart: T, cycleId: 'old-cyc', rung: 3, at: T, cost: 6, applied: 0, refunded: 0 },
    ])
    await d.redos.put({ id: 'r1', ticketId: 'p200', source: 'gave_up', createdAt: T - 3 * DAY, stage: 0, due: T - MIN, passed: [], helpCost: 10, refunded: 0 })
    await open('p200', { d, at: T }) // same T as the already-recorded uses above, but a different cycle id
    expect(screen.getByTestId('redo-banner')).toBeInTheDocument()
    expect(NAMES.map(n => rung(n).dataset.state)).toEqual(['open', 'locked', 'locked', 'locked', 'locked'])
    expect(spent()).toBe('0')
  })

  it('C-INT I-08/I-09 a due redo with a stored picture replays it until the timer runs; free', async () => {
    const d = await seededDb()
    const pic = fakeOutput('picture', { ticket: { id: 'p200', title: 'Number of Islands', track: 'dsa' }, context: {} } as never)
    await d.tickets.update('p200', { ai: { picture: pic } })
    await d.redos.put({ id: 'r1', ticketId: 'p200', source: 'gave_up', createdAt: T - 3 * DAY, stage: 0, due: T - MIN, passed: [], helpCost: 10, refunded: 0 })
    await open('p200', { d })
    expect(screen.getByTestId('redo-banner')).toBeInTheDocument()
    const replay = screen.getByRole('region', { name: 'Replay before you start' })
    expect(replay).toHaveAttribute('data-testid', 'redo-replay')
    expect(replay).toHaveTextContent('Watch it once, then rebuild it from memory in your log.')
    expect(within(replay).getByTestId('lab-player')).toHaveAttribute('data-record', 'false')
    expect(spent()).toBe('0')
    expect(screen.getByTestId('do-outcome-solved')).toBeEnabled()
    fireEvent.click(screen.getByTestId('do-timer-preset-25'))
    await waitFor(() => expect(screen.queryByTestId('redo-replay')).toBeNull())
  })

  it('C-INT I-10 no replay without a stored picture, and none outside a redo', async () => {
    const d = await seededDb()
    await d.redos.put({ id: 'r2', ticketId: 'p200', source: 'gave_up', createdAt: T - 3 * DAY, stage: 0, due: T - MIN, passed: [], helpCost: 5, refunded: 0 })
    await open('p200', { d })
    expect(screen.getByTestId('redo-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('redo-replay')).toBeNull()
  })
})

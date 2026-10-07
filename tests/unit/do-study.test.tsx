import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Do } from '../../src/screens/Do'
import StudyRunner from '../../src/study/StudyRunner'
import { setNow } from '../../src/lib/clock'
import { loadStudy, saveStudy, STUDY_KEY } from '../../src/lib/studyStore'
import { startStudy } from '../../src/rules/studySession'
import { TIMER_KEY } from '../../src/lib/timer'
import { totalXp } from '../../src/rules/xp'
import type { Ticket } from '../../src/data/types'
import { otherCards } from '../../src/screens/do/study/PlanDialog'
import { seededDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const T = new Date('2026-09-08T21:10:00+05:30').getTime()
const MIN = 60_000
let clock = T

async function open(id: string) {
  clock = T
  setNow(() => clock)
  const d = await seededDb()
  renderWithApp(<><Do /><StudyRunner /></>, { db: d, plan: smallPlan, route: `/do/${id}`, path: '/do/:ticketId' })
  return d
}

async function startSession(opts: { goal?: string; cycle?: string } = {}) {
  fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
  const dlg = await screen.findByRole('dialog', { name: 'Plan this session' })
  if (opts.goal) fireEvent.change(within(dlg).getByLabelText('This session I will'), { target: { value: opts.goal } })
  if (opts.cycle) fireEvent.click(within(dlg).getByRole('radio', { name: opts.cycle }))
  fireEvent.click(within(dlg).getByRole('button', { name: 'Start' }))
  await screen.findByTestId('session-timer')
}

/** Move the fake wall clock and let the 1 s tick notice it. */
async function elapse(min: number, then: () => void) {
  clock += min * MIN
  await waitFor(then, { timeout: 4000 })
}

describe('Do: plan step (UX-06)', () => {
  it('Start session opens "Plan this session" with the goal field, the three cycles and Start', async () => {
    await open('p127')
    fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
    const dlg = await screen.findByRole('dialog', { name: 'Plan this session' })
    expect(within(dlg).getByLabelText('This session I will')).toBeInTheDocument()
    expect(within(dlg).getByRole('radio', { name: '25 / 5' })).toBeChecked()
    expect(within(dlg).getByRole('radio', { name: '50 / 10' })).not.toBeChecked()
    expect(within(dlg).getByRole('radio', { name: 'Custom' })).not.toBeChecked()
    expect(within(dlg).getByRole('button', { name: 'Start' })).toBeInTheDocument()
  })

  it('offers the card and other open cards of the sprint; Custom reveals focus and break minutes', async () => {
    await open('m1w1t1')
    fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
    const dlg = await screen.findByRole('dialog', { name: 'Plan this session' })
    const own = within(dlg).getAllByRole('checkbox')[0]
    expect(own).toBeChecked()
    expect(own).toBeDisabled()
    fireEvent.click(within(dlg).getByRole('radio', { name: 'Custom' }))
    expect(within(dlg).getByLabelText('Focus minutes')).toBeInTheDocument()
    expect(within(dlg).getByLabelText('Break minutes')).toBeInTheDocument()
  })

  it('a bad custom cycle is refused with an alert and nothing starts', async () => {
    await open('p127')
    fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
    const dlg = await screen.findByRole('dialog', { name: 'Plan this session' })
    fireEvent.click(within(dlg).getByRole('radio', { name: 'Custom' }))
    fireEvent.change(within(dlg).getByLabelText('Focus minutes'), { target: { value: '0' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Start' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Focus minutes must be 1 to 180.')
    expect(localStorage.getItem(STUDY_KEY)).toBeNull()
  })

  it('Start runs the timer, moves the ticket to Doing and keeps the card text and plan beside it', async () => {
    const d = await open('m1w1t1')
    await startSession({ goal: 'finish rung 1' })
    expect(screen.getByTestId('session-timer')).toHaveTextContent('25:00')
    expect(screen.getByTestId('session-phase')).toHaveTextContent('Focus')
    const brief = screen.getByTestId('session-brief')
    const t = (await d.tickets.get('m1w1t1'))!
    expect(t.status).toBe('doing')
    expect(brief).toHaveTextContent(t.title)
    expect(brief).toHaveTextContent('This session I will: finish rung 1')
    expect(brief).toHaveTextContent(t.text!.slice(0, 30))
    expect(JSON.parse(localStorage.getItem(TIMER_KEY)!)).toMatchObject({ ticketId: 'm1w1t1', min: 25, running: true })
    expect(loadStudy()).toMatchObject({ ticketId: 'm1w1t1', goal: 'finish rung 1', focusMin: 25, breakMin: 5 })
  })

  it('all paragraphs on Do stay Chivo reading text (a class, not an inline size)', async () => {
    await open('p127')
    await startSession()
    for (const p of document.querySelectorAll('[data-testid="do-screen"] p')) expect(p.className).not.toMatch(/pixel/)
  })
})

describe('otherCards', () => {
  const mk = (id: string, over: Partial<Ticket> = {}) => mkTicket({ id, sprint: 3, track: 'interview', status: 'todo', order: Number(id.slice(1)), ...over })
  it('lists every open, non-archived card of the same sprint, any track, in plan order (shell-today-board A2)', () => {
    const me = mk('c0')
    const all = [me, mk('c5'), mk('c2'), mk('c3', { status: 'done' }), mk('c4', { archived: true }), mk('c6', { sprint: 4 }), mk('c7', { track: 'ai' }),
      ...['c8', 'c9', 'c10', 'c11', 'c12', 'c13'].map(id => mk(id))]
    expect(otherCards(all, me).map(t => t.id)).toEqual(['c2', 'c5', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12', 'c13'])
  })
  it('does not list a split parent beside its parts (cu-r1 P3-6)', () => {
    const me = mk('c0')
    const all = [me, mk('c1', { children: ['c2', 'c3'] }), mk('c2', { childOf: 'c1' }), mk('c3', { childOf: 'c1' })]
    expect(otherCards(all, me).map(t => t.id)).toEqual(['c2', 'c3'])
  })
})

describe('Do: Pomodoro cycles (UX-07)', () => {
  it('25 minutes later the phase reads Break and a focus event of 25 minutes is stored; 5 more and it is Focus', async () => {
    const d = await open('p127')
    await startSession()
    await elapse(25, () => expect(screen.getByTestId('session-phase')).toHaveTextContent('Break'))
    await waitFor(async () => expect((await d.events.toArray()).filter(e => e.t === 'focus')).toHaveLength(1))
    expect((await d.events.toArray()).find(e => e.t === 'focus')).toMatchObject({ t: 'focus', id: 'p127', minutes: 25 })
    await elapse(5, () => expect(screen.getByTestId('session-phase')).toHaveTextContent('Focus'))
    expect((await d.events.toArray()).filter(e => e.t === 'focus')).toHaveLength(1)
  })

  it('the break after the 4th focus block is a Long break, and focus minutes add no XP', async () => {
    const d = await open('p127')
    const xp0 = totalXp(await d.tickets.toArray())
    await startSession()
    for (let i = 0; i < 3; i++) {
      await elapse(25, () => expect(screen.getByTestId('session-phase')).toHaveTextContent(/^Break$/))
      await elapse(5, () => expect(screen.getByTestId('session-phase')).toHaveTextContent(/^Focus$/))
    }
    await elapse(25, () => expect(screen.getByTestId('session-phase')).toHaveTextContent('Long break'))
    await waitFor(async () => expect((await d.events.toArray()).filter(e => e.t === 'focus')).toHaveLength(4))
    expect(totalXp(await d.tickets.toArray())).toBe(xp0)
  }, 30_000)

  it('the attempt cycle banks the focus minutes so the ladder timer keeps its meaning', async () => {
    await open('p127')
    await startSession()
    await elapse(25, () => expect(screen.getByTestId('session-phase')).toHaveTextContent('Break'))
    expect(screen.getByTestId('do-timer-elapsed')).toHaveAttribute('data-seconds', String(25 * 60))
  })
})

describe('Do: focus mode (UX-08)', () => {
  it('f (or the button) shows only the brief, the timer, Notes and the two buttons; Esc restores and the timer runs on', async () => {
    await open('m1w1t1')
    await startSession({ goal: 'g' })
    fireEvent.keyDown(window, { key: 'f' })
    await screen.findByRole('button', { name: 'Exit focus mode' })
    expect(screen.getByTestId('session-brief')).toBeInTheDocument()
    expect(screen.getByTestId('session-timer')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument()
    expect(screen.getAllByRole('button').map(b => b.textContent).sort()).toEqual(['End session', 'Exit focus mode'])
    expect(screen.queryAllByRole('link')).toHaveLength(0)
    expect(screen.getByTestId('ladder')).not.toBeVisible() // mounted underneath, but hidden
    expect(screen.getByTestId('do-back')).not.toBeVisible()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findByTestId('do-back')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/do/m1w1t1')
    expect(screen.getByTestId('session-timer')).toBeInTheDocument()
    expect(loadStudy()).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Focus mode' }))
    expect(await screen.findByRole('button', { name: 'Exit focus mode' })).toBeInTheDocument()
  })

  it('f is ignored while typing in a field, and does nothing without a session', async () => {
    await open('p127')
    fireEvent.keyDown(window, { key: 'f' })
    expect(screen.queryByRole('button', { name: 'Exit focus mode' })).toBeNull()
    await startSession()
    const notes = screen.getByRole('textbox', { name: 'Notes' })
    fireEvent.keyDown(notes, { key: 'f' })
    expect(screen.queryByRole('button', { name: 'Exit focus mode' })).toBeNull()
  })
})

describe('Do: stuck prompt (UX-09)', () => {
  it('a focus block with no progress ends with a "Stuck?" dialog; "I\'m fine" closes it and it does not return in that block', async () => {
    await open('p127')
    await startSession()
    await elapse(25, () => expect(screen.getByRole('dialog', { name: 'Stuck?' })).toBeInTheDocument())
    const dlg = screen.getByRole('dialog', { name: 'Stuck?' })
    expect(within(dlg).getByRole('button', { name: 'Open the next help rung' })).toBeInTheDocument()
    expect(within(dlg).getByRole('button', { name: 'Take a 5-minute break' })).toBeInTheDocument()
    fireEvent.click(within(dlg).getByRole('button', { name: "I'm fine" }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stuck?' })).toBeNull())
    clock += MIN
    await act(async () => { await new Promise(r => setTimeout(r, 1300)) })
    expect(screen.queryByRole('dialog', { name: 'Stuck?' })).toBeNull()
  })

  it('a note typed in the block suppresses it', async () => {
    await open('p127')
    await startSession()
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'two pointers' } })
    await elapse(25, () => expect(screen.getByTestId('session-phase')).toHaveTextContent('Break'))
    expect(screen.queryByRole('dialog', { name: 'Stuck?' })).toBeNull()
  })

  it('it prompts again in the next block if that one has no progress either', async () => {
    await open('p127')
    await startSession()
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'x' } })
    await elapse(25, () => expect(screen.getByTestId('session-phase')).toHaveTextContent('Break'))
    await elapse(5, () => expect(screen.getByTestId('session-phase')).toHaveTextContent('Focus'))
    await elapse(25, () => expect(screen.getByRole('dialog', { name: 'Stuck?' })).toBeInTheDocument())
  })

  it('"Take a 5-minute break" makes the break exactly five minutes from now', async () => {
    await open('p127')
    await startSession({ cycle: '50 / 10' })
    await elapse(50, () => expect(screen.getByRole('dialog', { name: 'Stuck?' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Take a 5-minute break' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stuck?' })).toBeNull())
    expect(screen.getByTestId('session-phase')).toHaveTextContent('Break')
    await waitFor(() => expect(screen.getByTestId('session-timer')).toHaveTextContent(/0[45]:\d\d/))
  })

  it('"Open the next help rung" opens an unlocked rung (or says none is unlocked)', async () => {
    await open('p127')
    await startSession()
    await elapse(25, () => expect(screen.getByRole('dialog', { name: 'Stuck?' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Open the next help rung' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stuck?' })).toBeNull())
    // 25 banked minutes unlock the Hint rung: it is now open
    await waitFor(() => expect(screen.getByTestId('ladder-rung-hint')).toHaveAttribute('data-state', 'open'), { timeout: 4000 })
  })
})

describe('Do: a Stuck? prompt with no help rung to open says why on the page (UAT cu-4 P3-5)', () => {
  it('a 1-minute block ends with the Hint still locked: the dialog explains it and keeps the button off, no toast', async () => {
    await open('p127')
    fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
    const plan = await screen.findByRole('dialog', { name: 'Plan this session' })
    fireEvent.click(within(plan).getByRole('radio', { name: 'Custom' }))
    fireEvent.change(within(plan).getByLabelText('Focus minutes'), { target: { value: '1' } })
    fireEvent.change(within(plan).getByLabelText('Break minutes'), { target: { value: '1' } })
    fireEvent.click(within(plan).getByRole('button', { name: 'Start' }))
    await screen.findByTestId('session-timer')
    await elapse(1, () => expect(screen.getByRole('dialog', { name: 'Stuck?' })).toBeInTheDocument())
    const dlg = screen.getByRole('dialog', { name: 'Stuck?' })
    expect(within(dlg).getByTestId('stuck-no-rung')).toHaveTextContent('No help rung is unlocked yet: the Hint opens after 10 minutes on this attempt (9 min to go).')
    const rung = within(dlg).getByRole('button', { name: 'Open the next help rung' })
    expect(rung).toBeDisabled()
    expect(rung).toHaveAccessibleDescription(/Hint opens after 10 minutes/)
    expect(screen.queryByText('No help rung is unlocked yet', { selector: '[data-testid="toast"]' })).toBeNull()
    fireEvent.click(within(dlg).getByRole('button', { name: "I'm fine" }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Stuck?' })).toBeNull())
  })
})

describe('Do: end log (UX-10, UX-11)', () => {
  it('End session asks Done / Stuck on / Next step (max 280) and Save writes one studied session row', async () => {
    const d = await open('p127')
    const xp0 = totalXp(await d.tickets.toArray())
    await startSession({ goal: 'trace it' })
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    const dlg = await screen.findByRole('dialog', { name: 'End session' })
    for (const name of ['Done', 'Stuck on', 'Next step']) expect(within(dlg).getByRole('textbox', { name })).toHaveAttribute('maxlength', '280')
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Done' }), { target: { value: 'the loop' } })
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Next step' }), { target: { value: 'edge cases' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await d.sessions.count()).toBe(1))
    const s = (await d.sessions.toArray())[0]
    expect(s).toMatchObject({ ticketId: 'p127', outcome: 'studied', xpDelta: 0, goal: 'trace it', endLog: { done: 'the loop', stuckOn: '', nextStep: 'edge cases' } })
    expect(totalXp(await d.tickets.toArray())).toBe(xp0)
    await waitFor(() => expect(screen.queryByTestId('session-timer')).toBeNull())
    expect(localStorage.getItem(STUDY_KEY)).toBeNull()
    expect(localStorage.getItem(TIMER_KEY)).toBeNull()
  })

  it('Keep going closes the dialog and leaves the session running', async () => {
    const d = await open('p127')
    await startSession()
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Keep going' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'End session' })).toBeNull())
    expect(screen.getByTestId('session-timer')).toBeInTheDocument()
    expect(await d.sessions.count()).toBe(0)
  })

  it('Keep going keeps what was typed: reopening shows the same three texts, and Save then starts the next session empty (cu-2 P3-8)', async () => {
    await open('p127')
    await startSession()
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    let dlg = await screen.findByRole('dialog', { name: 'End session' })
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Done' }), { target: { value: 'the loop' } })
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Stuck on' }), { target: { value: 'queue order' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Keep going' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'End session' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    dlg = await screen.findByRole('dialog', { name: 'End session' })
    expect(within(dlg).getByRole('textbox', { name: 'Done' })).toHaveValue('the loop')
    expect(within(dlg).getByRole('textbox', { name: 'Stuck on' })).toHaveValue('queue order')
    expect(within(dlg).getByRole('textbox', { name: 'Next step' })).toHaveValue('')
    expect(within(dlg).getByText('8 / 280')).toBeInTheDocument()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(localStorage.getItem(STUDY_KEY)).toBeNull())
    // the next session's dialog does not inherit it
    await startSession()
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    dlg = await screen.findByRole('dialog', { name: 'End session' })
    expect(within(dlg).getByRole('textbox', { name: 'Done' })).toHaveValue('')
  })

  it('Solved while a session runs closes the session too', async () => {
    await open('p127')
    await startSession()
    fireEvent.click(screen.getByRole('button', { name: 'Solved ✓' }))
    await waitFor(() => expect(localStorage.getItem(STUDY_KEY)).toBeNull())
  })
})

describe('Do: one session at a time, and it survives a reload', () => {
  it('resumes a stored session for this card', async () => {
    clock = T
    setNow(() => clock)
    saveStudy(startStudy({ id: 's', ticketId: 'p127', goal: 'resume me', cardIds: ['p127'], focusMin: 25, breakMin: 5, chime: false, now: T - 5 * MIN }), undefined)
    const d = await seededDb()
    renderWithApp(<><Do /><StudyRunner /></>, { db: d, plan: smallPlan, route: '/do/p127', path: '/do/:ticketId' })
    expect(await screen.findByTestId('session-timer')).toHaveTextContent('20:00')
    expect(screen.getByTestId('session-brief')).toHaveTextContent('resume me')
    expect(screen.queryByRole('button', { name: 'Start session' })).toBeNull()
  })

  it('a session running on another card refuses a second one', async () => {
    clock = T
    setNow(() => clock)
    saveStudy(startStudy({ id: 's', ticketId: 'p1', goal: '', cardIds: ['p1'], focusMin: 25, breakMin: 5, chime: false, now: T - MIN }), undefined)
    const d = await seededDb()
    renderWithApp(<><Do /><StudyRunner /></>, { db: d, plan: smallPlan, route: '/do/p127', path: '/do/:ticketId' })
    fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
    // UAT cu-4 P3-5: a dialog, not a toast; a session has its own End log, so it is not ended from here
    const dlg = await screen.findByRole('alertdialog', { name: 'A study session is already running' })
    expect(within(dlg).queryByRole('button', { name: /^Stop it/ })).toBeNull()
    expect(within(dlg).getByRole('button', { name: 'Go to that card' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Plan this session' })).toBeNull()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('a session found past a sleep gap shows "Welcome back": Resume restarts the phase, End opens the End session dialog', async () => {
    clock = T + 8 * 60 * MIN
    setNow(() => clock)
    saveStudy(startStudy({ id: 's', ticketId: 'p127', goal: '', cardIds: ['p127'], focusMin: 25, breakMin: 5, chime: false, now: T }), undefined)
    const d = await seededDb()
    renderWithApp(<><Do /><StudyRunner /></>, { db: d, plan: smallPlan, route: '/do/p127', path: '/do/:ticketId' })
    const dlg = await screen.findByRole('dialog', { name: 'Welcome back' }, { timeout: 4000 })
    expect(dlg).toHaveTextContent('You were away: Resume or End?')
    expect(await d.events.count()).toBe(1) // the block that was running is credited, nothing more
    fireEvent.click(within(dlg).getByRole('button', { name: 'End' }))
    const end = await screen.findByRole('dialog', { name: 'End session' })
    fireEvent.click(within(end).getByRole('button', { name: 'Save' }))
    await waitFor(async () => expect(await d.sessions.count()).toBe(1))
    expect((await d.sessions.toArray())[0]).toMatchObject({ outcome: 'studied' })
    expect(localStorage.getItem(STUDY_KEY)).toBeNull()
  })

  it('Resume closes Welcome back and keeps the session', async () => {
    clock = T + 8 * 60 * MIN
    setNow(() => clock)
    saveStudy(startStudy({ id: 's', ticketId: 'p127', goal: '', cardIds: ['p127'], focusMin: 25, breakMin: 5, chime: false, now: T }), undefined)
    const d = await seededDb()
    renderWithApp(<><Do /><StudyRunner /></>, { db: d, plan: smallPlan, route: '/do/p127', path: '/do/:ticketId' })
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Welcome back' }, { timeout: 4000 })).getByRole('button', { name: 'Resume' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Welcome back' })).toBeNull())
    expect(loadStudy()).toMatchObject({ away: null, phaseStart: clock })
  })
})

describe('Do: read-only, focus overlay, stuck prompt focus', () => {
  it('Start session is refused with the Read-only toast in a browser without the writer token', async () => {
    await open('p127')
    localStorage.removeItem('dojo.writer')
    fireEvent.click(await screen.findByRole('button', { name: 'Start session' }))
    expect(await screen.findByText(/Read-only/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Plan this session' })).toBeNull()
    localStorage.setItem('dojo.writer', 'test-writer')
  })

  it('focus mode is an overlay: the screen stays mounted (typed notes survive) and Notes gets the cursor', async () => {
    await open('p127')
    await startSession()
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'kept' } })
    fireEvent.keyDown(window, { key: 'f' })
    const notes = await screen.findByRole('textbox', { name: 'Notes' })
    expect(notes).toHaveFocus()
    expect(notes).toHaveValue('kept')
    expect(screen.getByTestId('do-screen')).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findByTestId('do-back')).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('kept')
  })

  it('the Stuck? dialog opens with focus on "I\'m fine"; the next help rung leaves focus mode', async () => {
    await open('p127')
    await startSession()
    fireEvent.keyDown(window, { key: 'f' })
    await screen.findByRole('button', { name: 'Exit focus mode' })
    await elapse(25, () => expect(screen.getByRole('dialog', { name: 'Stuck?' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: "I'm fine" })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Open the next help rung' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Exit focus mode' })).toBeNull())
    await waitFor(() => expect(screen.getByTestId('ladder-rung-hint')).toHaveAttribute('data-state', 'open'), { timeout: 4000 })
    expect(screen.getByTestId('ladder')).toBeVisible()
  })
})

describe('Do: session history (UX-18)', () => {
  it('lists this ticket\'s past end logs, newest first, and no other ticket\'s', async () => {
    const d = await open('p127')
    expect(screen.queryByTestId('session-history')).toBeNull()
    const base = { xpDelta: 0, outcome: 'studied' as const }
    await d.sessions.add({ ...base, id: 'a', ticketId: 'p127', start: T - 90 * MIN, end: T - 60 * MIN, minutes: 30, goal: 'old goal', endLog: { done: 'older done', stuckOn: '', nextStep: '' } })
    await d.sessions.add({ ...base, id: 'b', ticketId: 'p127', start: T - 50 * MIN, end: T - 20 * MIN, minutes: 30, endLog: { done: 'newer done', stuckOn: 'the queue', nextStep: 'edge cases' } })
    await d.sessions.add({ ...base, id: 'c', ticketId: 'p1', start: T - 50 * MIN, end: T - 20 * MIN, minutes: 30, endLog: { done: 'other card', stuckOn: '', nextStep: '' } })
    const box = await screen.findByTestId('session-history')
    await waitFor(() => expect(within(box).getAllByRole('listitem')).toHaveLength(2))
    expect(box).toHaveTextContent('Done: newer done')
    expect(box).toHaveTextContent('Stuck on: the queue')
    expect(box).toHaveTextContent('Next step: edge cases')
    expect(box).toHaveTextContent('This session I will: old goal')
    expect(box).not.toHaveTextContent('other card')
    expect(within(box).getAllByRole('listitem').map(li => li.getAttribute('data-testid'))).toEqual(['session-history-b', 'session-history-a'])
  })

  it('labels each row\'s length: the session\'s own clock time, and its focus minutes when it kept them (ruling 24 S3)', async () => {
    const d = await open('p127')
    const base = { xpDelta: 0, outcome: 'studied' as const }
    await d.sessions.add({ ...base, id: 'a', ticketId: 'p127', start: T - 90 * MIN, end: T - 60 * MIN, minutes: 30, focusMinutes: 25, endLog: { done: 'x', stuckOn: '', nextStep: '' } })
    await d.sessions.add({ ...base, id: 'b', ticketId: 'p127', start: T - 50 * MIN, end: T - 20 * MIN, minutes: 30, endLog: { done: 'y', stuckOn: '', nextStep: '' } })
    const box = await screen.findByTestId('session-history')
    await waitFor(() => expect(within(box).getAllByRole('listitem')).toHaveLength(2))
    const heads = within(box).getAllByTestId('hist-length').map(e => e.textContent ?? '')
    expect(heads[1]).toMatch(/ · 30 min session · 25 min focus$/)
    expect(heads[0]).toMatch(/ · 30 min session$/)
  })
})

describe('Do: Notes and the Attempt log are two fields (ui-do D3.6, D3.9; UAT cu-4 P3-10)', () => {
  it('during a session the Study session Notes and the Attempt log both show, and typing in one never shows in the other', async () => {
    await open('p127')
    await startSession()
    const notes = screen.getByRole('textbox', { name: 'Notes' })
    const log = screen.getByLabelText('What is the invariant? What did you try?')
    expect(notes).not.toBe(log)
    fireEvent.change(notes, { target: { value: 'ch1: slope of a secant' } })
    expect(log).toHaveValue('')
    fireEvent.change(log, { target: { value: 'invariant: window sum' } })
    expect(notes).toHaveValue('ch1: slope of a secant')
    await waitFor(() => expect(JSON.parse(localStorage.getItem('dojo-draft:p127')!)).toMatchObject({ notes: 'invariant: window sum', sessionNotes: 'ch1: slope of a secant' }))
  })

  it('a new session starts with an empty Notes box; the attempt log stays with the card (UAT cu-2p P3-4)', async () => {
    await open('p127')
    await startSession({ goal: 'first' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'ch1 notes' } })
    fireEvent.change(screen.getByLabelText('What is the invariant? What did you try?'), { target: { value: 'invariant: sum' } })
    fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    const dlg = await screen.findByRole('dialog', { name: 'End session' })
    fireEvent.change(within(dlg).getByRole('textbox', { name: 'Done' }), { target: { value: 'x' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByTestId('session-timer')).toBeNull())
    await startSession({ goal: 'second' })
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('')
    expect(screen.getByLabelText('What is the invariant? What did you try?')).toHaveValue('invariant: sum')
    await waitFor(() => expect(JSON.parse(localStorage.getItem('dojo-draft:p127')!)).toMatchObject({ notes: 'invariant: sum', sessionNotes: '' }))
  })

  it('an AI card keeps its Repo and Proof apart from the session Notes too', async () => {
    await open('m1w1t1')
    await startSession()
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'pad' } })
    expect(screen.getByRole('textbox', { name: 'Proof' })).toHaveValue('')
    fireEvent.change(screen.getByRole('textbox', { name: 'Proof' }), { target: { value: 'ran 3 ms' } })
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('pad')
  })

  it('the pad and the log meet only when the attempt closes: one session row keeps both', async () => {
    const d = await open('p127')
    await startSession({ goal: 'redo it' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'pad text' } })
    fireEvent.change(screen.getByLabelText('What is the invariant? What did you try?'), { target: { value: 'log text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Solved ✓' }))
    await waitFor(async () => expect((await d.sessions.toArray()).some(s => s.outcome === 'solved')).toBe(true))
    const row = (await d.sessions.toArray()).find(s => s.outcome === 'solved')!
    expect(row.notes).toBe('log text\n\nStudy session notes:\npad text')
  })
})

describe('Do: Solved ✓ ends a running study session, and says so (UAT cu-4 P3-11)', () => {
  it('says so before the click, ends the session on Solved ✓ with a toast, and lists it under Earlier sessions', async () => {
    const d = await open('p127')
    await startSession({ goal: 'redo decode ways' })
    expect(screen.getByTestId('do-session-note')).toHaveTextContent('Solved ✓, Solved with help and Give up also end your study session (0 focus blocks so far)')
    expect(screen.getByRole('button', { name: 'Solved ✓' })).toHaveAccessibleDescription(/also end your study session/)
    await elapse(25, () => expect(screen.getByTestId('session-phase')).toHaveTextContent('Break'))
    expect(screen.getByTestId('do-session-note')).toHaveTextContent('(1 focus block so far)')
    fireEvent.click(screen.getByRole('button', { name: 'Solved ✓' }))
    expect(await screen.findByText('Study session ended with the card · 1 focus block')).toBeInTheDocument()
    await waitFor(() => expect(loadStudy()).toBeNull())
    // the session is a row: the plan line, and the focus minutes it kept
    const row = (await d.sessions.toArray()).find(s => s.outcome === 'solved')!
    expect(row).toMatchObject({ goal: 'redo decode ways', focusMinutes: 25 })
  })

  it('a session closed that way is listed under Earlier sessions with what ended it; a plain attempt is not', async () => {
    const d = await open('p127')
    const base = { xpDelta: 0 }
    await d.sessions.add({ ...base, id: 'a', ticketId: 'p127', start: T - 90 * MIN, end: T - 60 * MIN, minutes: 30, outcome: 'solved', goal: 'redo it', focusMinutes: 50 })
    await d.sessions.add({ ...base, id: 'b', ticketId: 'p127', start: T - 50 * MIN, end: T - 20 * MIN, minutes: 30, outcome: 'gave_up', focusMinutes: 25 })
    await d.sessions.add({ ...base, id: 'c', ticketId: 'p127', start: T - 50 * MIN, end: T - 20 * MIN, minutes: 30, outcome: 'solved' }) // no study: not listed
    const box = await screen.findByTestId('session-history')
    await waitFor(() => expect(within(box).getAllByRole('listitem')).toHaveLength(2))
    expect(within(box).getByTestId('session-history-a')).toHaveTextContent('This session I will: redo it')
    expect(within(box).getByTestId('session-history-a')).toHaveTextContent('Ended by: Solved ✓')
    expect(within(box).getByTestId('session-history-a')).toHaveTextContent('50 min focus')
    expect(within(box).getByTestId('session-history-b')).toHaveTextContent('Ended by: Give up')
    expect(within(box).queryByTestId('session-history-c')).toBeNull()
  })

  it('without a session there is no such note', async () => {
    await open('p127')
    await screen.findByRole('button', { name: 'Start session' })
    expect(screen.queryByTestId('do-session-note')).toBeNull()
  })
})

describe('Do: save-status in the top rail (ux addendum 5)', () => {
  it('shows the same save-status as the header, inside the rail, and follows the state', async () => {
    const { setSaveState } = await import('../../src/data/sync/status')
    setSaveState('saved')
    await open('p127')
    const rail = (await screen.findByTestId('do-back')).closest('header') as HTMLElement
    expect(within(rail).getByTestId('save-status')).toHaveTextContent('Saved')
    act(() => setSaveState('saving'))
    await waitFor(() => expect(within(rail).getByTestId('save-status')).toHaveTextContent('Saving'))
    act(() => setSaveState('off'))
    await waitFor(() => expect(within(rail).queryByTestId('save-status')).toBeNull())
  })
})

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { draftBrief } from '../../src/data/briefActions'
import { submitCheck } from '../../src/data/checkActions'
import { closeLadderSession, recordRung } from '../../src/data/ladderActions'
import { setNow } from '../../src/lib/clock'
import { openCheck } from '../../src/lib/checkGate'
import { clearCycle, loadCycle, newCycle, saveCycle } from '../../src/lib/cycle'
import { clearDraft, loadDraft, saveDraft } from '../../src/lib/drafts'
import { loadStudy, saveStudy } from '../../src/lib/studyStore'
import { blockTimer } from '../../src/lib/studyTimer'
import { clearTimer, loadTimer, saveTimer } from '../../src/lib/timer'
import { startStudy } from '../../src/rules/studySession'
import { CheckGate } from '../../src/screens/brief/CheckGate'
import { Board } from '../../src/screens/Board'
import { Do } from '../../src/screens/Do'
import { Today } from '../../src/screens/Today'
import StudyRunner from '../../src/study/StudyRunner'
import { closeStudyOnCheckPass, finishStudy, runTick } from '../../src/study/runner'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'
import { mkTicket } from '../helpers/tickets'

// briefs Addendum 6: a passed learning check closes a study session running on that card as Solved does.
const MIN = 60_000
const T = new Date(2026, 8, 8, 12).getTime() // sprint 1 of a plan starting 2026-09-07
let clock = T
const good = [{ id: 'q1', answer: 'I can explain hash maps now' }, { id: 'q2', choice: 0 }]
const bad = [{ id: 'q1', answer: 'no idea' }, { id: 'q2', choice: 0 }]
const fx = () => ({ chime: vi.fn(), toast: vi.fn(), onError: vi.fn(), readOnly: false })

afterEach(() => localStorage.clear())

/** A briefed watch card with a study session two blocks in: cycle, block timer and a draft note stored. */
async function studying(ticketId = 'w1') {
  clock = T
  setNow(() => clock)
  const d = await seededDb()
  await d.tickets.put(mkTicket({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps', sprint: 1, order: -1, status: 'doing' }))
  await draftBrief(d, 'w1', T)
  const s = { ...startStudy({ id: 'st1', ticketId, goal: 'learn hashing', cardIds: [ticketId], focusMin: 25, breakMin: 5, chime: false, now: T - 60 * MIN }), phaseStart: T - 5 * MIN, blocks: 2 }
  saveStudy(s)
  saveCycle(newCycle({ ticketId, now: T - 60 * MIN, redo: null, netAtStart: 0, timer: null }))
  saveTimer(blockTimer(s, T - 5 * MIN, T + 20 * MIN, true))
  saveDraft(ticketId, { notes: 'buckets and probing', repo: '', note: '', sessionNotes: '' })
  return d
}

function expectClosed() {
  expect(loadStudy()).toBeNull()
  expect(loadTimer()).toBeNull()
  expect(loadCycle('w1')).toBeNull()
  expect(loadDraft('w1')).toEqual({ notes: '', repo: '', note: '', sessionNotes: '' })
}

async function answer(dialog: HTMLElement, pass: boolean) {
  fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: pass ? 'about hash maps' : 'no idea' } })
  fireEvent.click(within(dialog).getByRole('radio', { name: 'Hash maps' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Check answers' }))
  expect(await within(dialog).findByText(pass ? 'Passed' : 'Not yet', {}, { timeout: 5000 })).toBeInTheDocument()
}

describe('closeStudyOnCheckPass (the shared pass path)', () => {
  it('writes one solved session row with the goal and focus minutes, and clears study, timer, cycle and draft', async () => {
    const d = await studying()
    expect(await submitCheck(d, 'w1', good, T)).toMatchObject({ ok: true, passed: true })
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })).toBe(true)
    const rows = await d.sessions.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ticketId: 'w1', outcome: 'solved', goal: 'learn hashing', focusMinutes: 50, notes: 'buckets and probing', start: T - 60 * MIN, end: T })
    expect(await d.tickets.get('w1')).toMatchObject({ status: 'done', xp: 10 })
    expectClosed()
    // idempotent: nothing is left to close
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })).toBe(false)
    expect(await d.sessions.count()).toBe(1)
  })

  it('says the session ended with the card (UAT cu-4 P3-11), and says nothing when there was no session', async () => {
    const d = await studying()
    await submitCheck(d, 'w1', good, T)
    const f = fx()
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...f })).toBe(true)
    expect(f.toast).toHaveBeenCalledWith('Study session ended with the card · 2 focus blocks')
    // no study session, an open attempt only: the pass closes it, with no study line
    const g = fx()
    const e = await seededDb()
    await e.tickets.put(mkTicket({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps', sprint: 1, order: -1, status: 'doing' }))
    await draftBrief(e, 'w1', T)
    saveCycle(newCycle({ ticketId: 'w1', now: T - 60 * MIN, redo: null, netAtStart: 0, timer: null }))
    await submitCheck(e, 'w1', good, T)
    expect(await closeStudyOnCheckPass({ d: e, ticketId: 'w1', nowMs: T, ...g })).toBe(true)
    expect(g.toast).not.toHaveBeenCalled()
  })

  it('leaves a session running on another card alone', async () => {
    const d = await studying('p127')
    await submitCheck(d, 'w1', good, T)
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })).toBe(false)
    expect(loadStudy()).toMatchObject({ ticketId: 'p127' })
    expect(loadTimer()).toMatchObject({ ticketId: 'p127', running: true })
    expect(await d.sessions.count()).toBe(0)
  })

  it('does nothing in a read-only browser', async () => {
    const d = await studying()
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx(), readOnly: true })).toBe(false)
    expect(loadStudy()).not.toBeNull()
  })
})

describe('a pass with no study session (Addendum 10, BR-24c)', () => {
  /** No study, timer, cycle or draft: Do was never opened on the card. */
function noAttempt() {
  localStorage.removeItem('dojo-study')
  clearTimer()
  clearCycle('w1')
  clearDraft('w1')
}

/** A briefed watch card with a Do attempt open (cycle, running timer, draft) and no study. */
  async function attempt() {
    const d = await studying()
    localStorage.removeItem('dojo-study')
    saveTimer({ ticketId: 'w1', sessionStart: T - 30 * MIN, start: T - 30 * MIN, end: T + 60 * MIN, min: 90, running: true, notified: false })
    return d
  }

  it('an open Do attempt: one solved row (no goal, no focus), xpDelta from the pass, timer/draft/cycle cleared', async () => {
    const d = await attempt()
    const r = await submitCheck(d, 'w1', good, T)
    const earned = (r as { xpDelta: number }).xpDelta
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx(), xpDelta: earned })).toBe(true)
    const rows = await d.sessions.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ticketId: 'w1', outcome: 'solved', xpDelta: earned, start: T - 30 * MIN, end: T })
    expect(rows[0].goal).toBeUndefined()
    expect(rows[0].focusMinutes).toBeUndefined()
    expectClosed()
  })

  it('a stored cycle alone (no timer) still closes', async () => {
    const d = await attempt()
    clearTimer()
    await submitCheck(d, 'w1', good, T)
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })).toBe(true)
    expect((await d.sessions.toArray()).map(s => s.outcome)).toEqual(['solved'])
    expectClosed()
  })

  it('two closes write one row', async () => {
    const d = await attempt()
    await submitCheck(d, 'w1', good, T)
    await Promise.all([closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() }), closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })])
    expect(await d.sessions.count()).toBe(1)
  })

  it('no attempt and no study (ticked from Today, Do never opened): no row, nothing touched', async () => {
    const d = await studying()
    noAttempt()
    await submitCheck(d, 'w1', good, T)
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })).toBe(false)
    expect(await d.sessions.count()).toBe(0)
  })

  it('Today: a pass from the checkbox with Do never opened writes no session row', async () => {
    const d = await studying()
    noAttempt()
    renderWithApp(<><Today /><CheckGate /></>, { db: d, plan: smallPlan })
    fireEvent.click(await screen.findByRole('button', { name: /This sprint · \d+ tasks/ }))
    fireEvent.click(await screen.findByTestId('dig-tick-w1'))
    await answer(await screen.findByRole('dialog', { name: 'Check your understanding' }), true)
    await waitFor(async () => expect((await d.tickets.get('w1'))!.status).toBe('done'))
    expect(await d.sessions.count()).toBe(0)
  })

  it('Do open with the attempt: a pass closes it in Do (cycle state, no session bar)', async () => {
    const d = await attempt()
    renderWithApp(<><Do /><CheckGate /></>, { db: d, plan: smallPlan, route: '/do/w1', path: '/do/:ticketId' })
    await screen.findByTestId('do-back')
    openCheck('w1')
    await answer(await screen.findByRole('dialog', { name: 'Check your understanding' }), true)
    await waitFor(async () => expect((await d.sessions.toArray()).map(s => s.outcome)).toEqual(['solved']))
    expectClosed()
  })
})

describe('a passed check never schedules a help redo (Addendum 8, BR-24)', () => {
  /** Rung uses on the stored cycle: the Hint, and the Picture too when `deep` (deepest rung 3, a solved_help trigger). */
  async function withRungs(d: Awaited<ReturnType<typeof studying>>, deep: boolean) {
    const cycle = loadCycle('w1')!
    await recordRung(d, { ticketId: 'w1', attemptStart: cycle.attemptStart, cycleId: cycle.id, rung: 2, cost: 2, level: 1, at: T - 30 * MIN })
    if (deep) await recordRung(d, { ticketId: 'w1', attemptStart: cycle.attemptStart, cycleId: cycle.id, rung: 3, cost: 2, at: T - 20 * MIN })
    return cycle
  }
  const openRedos = async (d: Awaited<ReturnType<typeof studying>>) => (await d.redos.toArray()).filter(r => r.closedAt === undefined)

  for (const deep of [false, true]) {
    it(`study path: after ${deep ? 'the Hint and the Picture' : 'the Hint'} a pass writes exactly one solved row and opens no redo (the checkPass skip itself is proven in the live-redo tests below)`, async () => {
      const d = await studying()
      await withRungs(d, deep)
      expect(await submitCheck(d, 'w1', good, T)).toMatchObject({ ok: true, passed: true })
      expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })).toBe(true)
      expect(await openRedos(d)).toEqual([])
      expect((await d.sessions.toArray()).map(s => s.outcome)).toEqual(['solved'])
    })

    it(`no-study path: after ${deep ? 'the Hint and the Picture' : 'the Hint'} a pass with the study gone still closes the attempt: one solved row, cleared cycle, no redo`, async () => {
      const d = await studying()
      localStorage.removeItem('dojo-study')
      await withRungs(d, deep)
      expect(await submitCheck(d, 'w1', good, T)).toMatchObject({ ok: true, passed: true })
      expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })).toBe(true)
      expect(await openRedos(d)).toEqual([])
      expect((await d.sessions.toArray()).map(s => s.outcome)).toEqual(['solved'])
      expect(loadCycle('w1')).toBeNull()
    })
  }

  it('through closeStudyOnCheckPass, a cycle that began as a still-live redo is neither failed nor re-scheduled (fails if the checkPass skip is removed)', async () => {
    const d = await studying()
    const c = await withRungs(d, true)
    saveCycle({ ...c, redoId: 'r-live' })
    await submitCheck(d, 'w1', good, T)
    // a live redo written (e.g. by another tab) after the check itself ran: the close must leave it alone
    await d.redos.add({ id: 'r-live', ticketId: 'w1', source: 'solved_help', createdAt: T - 5 * 86_400_000, stage: 0, due: T - 86_400_000, passed: [], helpCost: 5, refunded: 0 })
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })).toBe(true)
    expect(await d.redos.get('r-live')).toMatchObject({ passed: [], stage: 0 })
    expect(await d.redos.count()).toBe(1)
    expect((await d.events.toArray()).filter(e => e.t === 'redo_fail' || e.t === 'redo_pass')).toEqual([])
  })

  it('a pass closing a cycle that began on a still-live redo neither fails it nor schedules one (checkPass)', async () => {
    const d = await studying()
    const cycle = await withRungs(d, true)
    // a live redo on the card that the cycle began as (e.g. written by another tab after the check closed its own)
    await d.redos.add({ id: 'r-live', ticketId: 'w1', source: 'solved_help', createdAt: T - 5 * 86_400_000, stage: 0, due: T - 86_400_000, passed: [], helpCost: 5, refunded: 0 })
    await d.tickets.update('w1', { status: 'done' })
    const r = await closeLadderSession(d, {
      ticketId: 'w1', outcome: 'solved', attemptStart: cycle.attemptStart, cycleId: cycle.id, sessionStart: T - 60 * MIN, now: T,
      netAtStart: 0, redoId: 'r-live', checkPass: true,
    })
    expect(r).toMatchObject({ ok: true, effect: { kind: 'none' } })
    expect(await d.redos.get('r-live')).toMatchObject({ passed: [], stage: 0 })
    expect(await d.redos.count()).toBe(1)
    expect((await d.events.toArray()).filter(e => e.t === 'redo_fail' || e.t === 'redo_pass')).toEqual([])
  })
})

describe('one row per session (Addendum 8, M1)', () => {
  const log = { done: 'read it', stuckOn: '', nextStep: '' }
  const rows = async (d: Awaited<ReturnType<typeof studying>>) => (await d.sessions.toArray()).map(s => s.outcome)

  it('End session after the pass writes no extra studied row', async () => {
    const d = await studying()
    await submitCheck(d, 'w1', good, T)
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })).toBe(true)
    expect(await finishStudy({ d, log, nowMs: T + MIN, ...fx() })).toBe(true)
    expect(await rows(d)).toEqual(['solved'])
  })

  it('End session racing the pass (another tab) still leaves exactly one row', async () => {
    const d = await studying()
    await submitCheck(d, 'w1', good, T)
    await Promise.all([closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() }), finishStudy({ d, log, nowMs: T, ...fx() })])
    expect(await d.sessions.count()).toBe(1)
    expect(loadStudy()).toBeNull()
  })

  it('Welcome back → End racing the pass leaves exactly one row', async () => {
    const d = await studying()
    saveStudy({ ...loadStudy()!, away: T - MIN })
    await submitCheck(d, 'w1', good, T)
    await Promise.all([finishStudy({ d, log, nowMs: T, ...fx() }), closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })])
    expect(await d.sessions.count()).toBe(1)
  })

  it('Welcome back → End after the pass leaves exactly one row and no studied row', async () => {
    const d = await studying()
    saveStudy({ ...loadStudy()!, away: T - MIN })
    await submitCheck(d, 'w1', good, T)
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })).toBe(true)
    expect(await finishStudy({ d, log, nowMs: T + MIN, ...fx() })).toBe(true)
    expect(await rows(d)).toEqual(['solved'])
  })

  it('two tabs closing on the same pass write one solved row', async () => {
    const d = await studying()
    await submitCheck(d, 'w1', good, T)
    await Promise.all([closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() }), closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })])
    expect(await rows(d)).toEqual(['solved'])
  })
})

describe('another tab\'s End wins the race (M-c)', () => {
  it('a duplicate close still clears the attempt cycle and the draft', async () => {
    const d = await studying()
    await submitCheck(d, 'w1', good, T)
    // End session in another tab already wrote the row under the study's id
    await d.sessions.add({ id: 's-st1', ticketId: 'w1', outcome: 'studied', start: T - 60 * MIN, end: T } as never)
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })).toBe(false)
    expect(await d.sessions.count()).toBe(1)
    expect(loadCycle('w1')).toBeNull()
    expect(loadDraft('w1')).toEqual({ notes: '', repo: '', note: '', sessionNotes: '' })
  })
})

describe('a focus block finishing during the pass (M2)', () => {
  const focusEvents = async (d: Awaited<ReturnType<typeof studying>>) => (await d.events.toArray()).filter(e => e.t === 'focus')

  it('a tick saved while the close awaits is included in focusMinutes', async () => {
    const d = await studying()
    await submitCheck(d, 'w1', good, T)
    const s = loadStudy()!
    // another tab's tick lands AFTER the close's first loadStudy read (just after its ticket read) and before its write
    const orig = d.tickets.get.bind(d.tickets)
    const spy = vi.spyOn(d.tickets, 'get').mockImplementationOnce((async (...args: unknown[]) => {
      const t = await (orig as (...a: unknown[]) => Promise<unknown>)(...args)
      saveStudy({ ...s, blocks: 3, phase: 'break', phaseStart: T - MIN, phaseMin: 5 })
      return t
    }) as never)
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx() })).toBe(true)
    spy.mockRestore()
    expect((await d.sessions.toArray())[0]).toMatchObject({ outcome: 'solved', focusMinutes: 75 })
  })

  it('a block that ended before the pass but was not yet credited is credited, and an in-flight tick adds nothing after', async () => {
    const d = await studying()
    const pass = T + 21 * MIN // the running block ended at T + 20
    clock = pass
    await submitCheck(d, 'w1', good, pass)
    const f = fx()
    await Promise.all([runTick(d, pass, f), closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: pass, ...fx() })])
    expect((await d.sessions.toArray()).map(s => [s.outcome, s.focusMinutes])).toEqual([['solved', 75]])
    const ev = await focusEvents(d)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ id: 'w1', at: T + 20 * MIN, minutes: 25, sid: 'st1', block: 3 })
    // later ticks find no session: nothing more is credited
    await runTick(d, pass + 60 * MIN, f)
    expect(await focusEvents(d)).toHaveLength(1)
    expect(loadStudy()).toBeNull()
  })

  it('the close, run alone after the block ended, credits it with its focus event before clearing', async () => {
    const d = await studying()
    const pass = T + 21 * MIN
    await submitCheck(d, 'w1', good, pass)
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: pass, ...fx() })).toBe(true)
    expect((await d.sessions.toArray())[0]).toMatchObject({ focusMinutes: 75 })
    expect((await focusEvents(d)).map(e => e.at)).toEqual([T + 20 * MIN])
  })
})

describe('failure and xp of the close (M4, M5)', () => {
  it('M4: a write error after the pass toasts that the session is still running', async () => {
    const d = await studying()
    await submitCheck(d, 'w1', good, T)
    const f = fx()
    const spy = vi.spyOn(d.sessions, 'add').mockRejectedValueOnce(new Error('disk full'))
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...f })).toBe(false)
    spy.mockRestore()
    expect(loadStudy()).not.toBeNull()
    expect([...f.toast.mock.calls, ...f.onError.mock.calls].some(c => /still running/i.test(String(c[0])))).toBe(true)
  })

  it('M-d: the still-running toast points at End session on the card\'s Do page', async () => {
    const d = await studying()
    await submitCheck(d, 'w1', good, T)
    const f = fx()
    const spy = vi.spyOn(d.sessions, 'add').mockRejectedValueOnce(new Error('disk full'))
    await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...f })
    spy.mockRestore()
    expect(f.toast).toHaveBeenCalledWith(expect.stringContaining("use End session on the card's Do page"), 'danger')
    expect(f.toast).not.toHaveBeenCalledWith(expect.stringContaining('session bar'), expect.anything())
  })

  it('M-d: a failure safeWrite already reported (quota) shows no second toast', async () => {
    const d = await studying()
    await submitCheck(d, 'w1', good, T)
    const f = fx()
    const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' })
    const spy = vi.spyOn(d.sessions, 'add').mockRejectedValueOnce(quota)
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...f })).toBe(false)
    spy.mockRestore()
    expect(f.onError).toHaveBeenCalledTimes(1)
    expect(f.toast).not.toHaveBeenCalled()
    expect(loadStudy()).not.toBeNull()
  })

  it('M4: read-only flipped after the pass toasts that the session is still running', async () => {
    const d = await studying()
    await submitCheck(d, 'w1', good, T)
    const f = fx()
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...f, readOnly: true })).toBe(false)
    expect(f.toast).toHaveBeenCalledWith(expect.stringMatching(/still running/i), expect.anything())
  })

  it('M5: with no cycle stored the solved row xpDelta is the xp the pass earned', async () => {
    const d = await studying()
    clearCycle('w1')
    const r = await submitCheck(d, 'w1', good, T)
    expect(r).toMatchObject({ ok: true, passed: true })
    const earned = (r as { xpDelta: number }).xpDelta
    expect(earned).toBeGreaterThan(0)
    expect(await closeStudyOnCheckPass({ d, ticketId: 'w1', nowMs: T, ...fx(), xpDelta: earned })).toBe(true)
    expect((await d.sessions.toArray())[0].xpDelta).toBe(earned)
  })
})

describe('the check dialog closes the session on a pass, on every screen (BR-21/BR-22)', () => {
  it('Board: a pass closes it and no further focus minutes are credited', async () => {
    const d = await studying()
    renderWithApp(<><Board /><CheckGate /><StudyRunner /></>, { db: d, plan: smallPlan, route: '/board', path: '/board' })
    fireEvent.click(within(await screen.findByTestId('card-w1')).getByRole('button', { name: 'Done ✓' }))
    await answer(await screen.findByRole('dialog', { name: 'Check your understanding' }), true)
    await waitFor(async () => expect((await d.sessions.toArray()).map(s => s.outcome)).toEqual(['solved']))
    expectClosed()
    clock += 25 * MIN
    await new Promise(r => setTimeout(r, 1200))
    expect((await d.events.toArray()).filter(e => e.t === 'focus')).toHaveLength(0)
    expect(await d.sessions.count()).toBe(1)
  })

  it('Board: a fail or a cancel leaves the session running and the card open', async () => {
    const d = await studying()
    renderWithApp(<><Board /><CheckGate /><StudyRunner /></>, { db: d, plan: smallPlan, route: '/board', path: '/board' })
    fireEvent.click(within(await screen.findByTestId('card-w1')).getByRole('button', { name: 'Done ✓' }))
    const dialog = await screen.findByRole('dialog', { name: 'Check your understanding' })
    await answer(dialog, false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(loadStudy()).toMatchObject({ id: 'st1', blocks: 2 })
    expect(loadTimer()).toMatchObject({ ticketId: 'w1', running: true })
    expect(loadCycle('w1')).not.toBeNull()
    expect((await d.tickets.get('w1'))!.status).toBe('doing')
    expect(await d.sessions.count()).toBe(0)
  })

  it('Today: a pass from the Today checkbox (useTick) closes it too', async () => {
    const d = await studying()
    renderWithApp(<><Today /><CheckGate /></>, { db: d, plan: smallPlan })
    fireEvent.click(await screen.findByRole('button', { name: /This sprint · \d+ tasks/ }))
    fireEvent.click(await screen.findByTestId('dig-tick-w1'))
    await answer(await screen.findByRole('dialog', { name: 'Check your understanding' }), true)
    await waitFor(async () => expect((await d.sessions.toArray()).map(s => s.outcome)).toEqual(['solved']))
    expectClosed()
  })

  it('Do: a pass while in focus mode ends the session view and focus mode', async () => {
    const d = await studying()
    renderWithApp(<><Do /><CheckGate /><StudyRunner /></>, { db: d, plan: smallPlan, route: '/do/w1', path: '/do/:ticketId' })
    await screen.findByTestId('session-timer')
    fireEvent.keyDown(window, { key: 'f' })
    await screen.findByRole('button', { name: 'Exit focus mode' })
    openCheck('w1')
    await answer(await screen.findByRole('dialog', { name: 'Check your understanding' }), true)
    await waitFor(async () => expect((await d.sessions.toArray()).map(s => s.outcome)).toEqual(['solved']))
    await waitFor(() => expect(screen.queryByTestId('session-timer')).toBeNull())
    expect(screen.queryByTestId('session-phase')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Exit focus mode' })).toBeNull()
    expectClosed()
    // focus mode really exited: a new session does not open straight into the overlay
    saveStudy(startStudy({ id: 'st2', ticketId: 'w1', goal: '', cardIds: ['w1'], focusMin: 25, breakMin: 5, chime: false, now: clock }))
    window.dispatchEvent(new Event('dojo-study-changed'))
    await screen.findByTestId('session-timer')
    expect(screen.queryByRole('button', { name: 'Exit focus mode' })).toBeNull()
  })
})

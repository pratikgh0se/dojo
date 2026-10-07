import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCycle, newCycle, saveCycle, cycleElapsedMs } from '../../src/lib/cycle'
import { loadStudy, saveStudy } from '../../src/lib/studyStore'
import { loadTimer, TIMER_KEY } from '../../src/lib/timer'
import { blockTimer } from '../../src/lib/studyTimer'
import { beginStudy, finishStudy, resumeAfterAway, runTick } from '../../src/study/runner'
import { startStudy } from '../../src/rules/studySession'
import { seededDb } from '../helpers/db'

const MIN = 60_000
const T0 = new Date('2026-10-06T09:00:00+05:30').getTime()
const fx = () => ({ chime: vi.fn(), toast: vi.fn(), onError: vi.fn(), readOnly: false })
const mkStudy = (over = {}) => startStudy({ id: 'st1', ticketId: 'p127', goal: 'g', cardIds: ['p127'], focusMin: 25, breakMin: 5, chime: true, now: T0, ...over })

async function running() {
  const d = await seededDb()
  const s = mkStudy()
  saveStudy(s)
  saveCycle(newCycle({ ticketId: 'p127', now: T0 - MIN, redo: null, netAtStart: 0, timer: null }))
  localStorage.setItem(TIMER_KEY, JSON.stringify(blockTimer(s, T0, T0 + 25 * MIN, true)))
  return d
}

beforeEach(() => localStorage.clear())

describe('runTick (the runner, on every screen)', () => {
  it('at the block end: credits the focus event once, banks the cycle, chimes, and moves to Break', async () => {
    const d = await running()
    const f = fx()
    await runTick(d, T0 + 25 * MIN, f)
    expect(loadStudy()).toMatchObject({ phase: 'break', blocks: 1 })
    const evs = (await d.events.toArray()).filter(e => e.t === 'focus')
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ minutes: 25, sid: 'st1', block: 1, id: 'p127' })
    expect(cycleElapsedMs(loadCycle('p127')!, loadTimer(), T0 + 25 * MIN)).toBe(25 * MIN)
    expect(f.chime).toHaveBeenCalledTimes(1)
    // a second call at the same instant changes nothing (no double credit)
    await runTick(d, T0 + 25 * MIN, f)
    expect((await d.events.toArray()).filter(e => e.t === 'focus')).toHaveLength(1)
    expect(f.chime).toHaveBeenCalledTimes(1)
  })

  it('is a no-op with no session, and before the block ends', async () => {
    const d = await seededDb()
    await runTick(d, T0, fx())
    saveStudy(mkStudy())
    await runTick(d, T0 + 10 * MIN, fx())
    expect(loadStudy()).toMatchObject({ phase: 'focus', blocks: 0 })
    expect(await d.events.count()).toBe(0)
  })

  it('two runners (two tabs) racing over one block credit exactly one focus event', async () => {
    const d = await running()
    await Promise.all([runTick(d, T0 + 25 * MIN, fx()), runTick(d, T0 + 25 * MIN, fx())])
    expect((await d.events.toArray()).filter(e => e.t === 'focus')).toHaveLength(1)
  })

  it('a rung opened or a tick in the block counts as progress, so no stuck prompt', async () => {
    const d = await running()
    await d.events.add({ t: 'rung', id: 'p127', at: T0 + 5 * MIN, rung: 2, cost: 2 })
    await runTick(d, T0 + 25 * MIN, fx())
    expect(loadStudy()!.stuck).toBe(false)
    const d2 = await running()
    await runTick(d2, T0 + 25 * MIN, fx())
    expect(loadStudy()!.stuck).toBe(true)
  })

  it('a sleep gap credits the running block, then parks the session as away without more credit', async () => {
    const d = await running()
    await runTick(d, T0 + 300 * MIN, fx())
    expect(loadStudy()).toMatchObject({ away: T0 + 300 * MIN, blocks: 1 })
    await runTick(d, T0 + 400 * MIN, fx())
    expect((await d.events.toArray()).filter(e => e.t === 'focus')).toHaveLength(1)
  })

  it('never writes a focus event in a read-only browser (the session still advances)', async () => {
    const d = await running()
    const f = fx()
    await runTick(d, T0 + 25 * MIN, { ...f, readOnly: true })
    expect(loadStudy()).toMatchObject({ phase: 'break' })
    expect(await d.events.count()).toBe(0)
  })

  it('resume restarts the current phase from now and starts the matching timer', async () => {
    const d = await running()
    await runTick(d, T0 + 300 * MIN, fx())
    resumeAfterAway(T0 + 310 * MIN)
    expect(loadStudy()).toMatchObject({ away: null, phase: 'break', phaseStart: T0 + 310 * MIN })
  })
})

describe('beginStudy / finishStudy', () => {
  const plan = { goal: 'g', focusMin: 25, breakMin: 5, cardIds: ['p127'], chime: true }
  it('begins: ticket to Doing, session and timer stored; a running plain timer is banked first', async () => {
    const d = await seededDb()
    const t = (await d.tickets.get('p127'))!
    const f = fx()
    expect(await beginStudy({ d, ticket: t, plan, nowMs: T0, ...f })).toBe(true)
    expect((await d.tickets.get('p127'))!.status).toBe('doing')
    expect(loadStudy()).toMatchObject({ ticketId: 'p127', goal: 'g', startedAt: T0 })
    expect(loadTimer()).toMatchObject({ running: true, min: 25 })
  })

  it('refuses while another card has a timer or session', async () => {
    const d = await seededDb()
    saveStudy(mkStudy({ ticketId: 'p1' }))
    const t = (await d.tickets.get('p127'))!
    const f = fx()
    expect(await beginStudy({ d, ticket: t, plan, nowMs: T0, ...f })).toBe(false)
    expect(f.toast).toHaveBeenCalled()
    expect(loadStudy()!.ticketId).toBe('p1')
  })

  it('finishes: one studied row with a deterministic id, timer and session cleared; a second finish is a no-op', async () => {
    const d = await running()
    const f = fx()
    const log = { done: 'a', stuckOn: '', nextStep: 'c' }
    expect(await finishStudy({ d, log, nowMs: T0 + 30 * MIN, ...f })).toBe(true)
    expect(await finishStudy({ d, log, nowMs: T0 + 30 * MIN, ...f })).toBe(true)
    const rows = await d.sessions.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 's-st1', outcome: 'studied', xpDelta: 0, endLog: { done: 'a', stuckOn: '', nextStep: 'c' } })
    expect(loadStudy()).toBeNull()
    expect(loadTimer()).toBeNull()
  })

  it('an away session still writes its studied row on End', async () => {
    const d = await running()
    await runTick(d, T0 + 300 * MIN, fx())
    expect(await finishStudy({ d, log: { done: '', stuckOn: '', nextStep: '' }, nowMs: T0 + 310 * MIN, ...fx() })).toBe(true)
    expect(await d.sessions.count()).toBe(1)
    expect(loadStudy()).toBeNull()
  })
})

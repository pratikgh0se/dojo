import { describe, expect, it } from 'vitest'
import { callJob } from '../../src/data/aiActions'
import { slideTicketsTo } from '../../src/data/boardActions'
import type { DojoDB } from '../../src/data/db'
import { closeLadderSession, markUnderstood, recordRung } from '../../src/data/ladderActions'
import type { HelpRung, Outcome } from '../../src/data/types'
import { freshDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T0 = ist('2026-10-06T21:10:00')
const MIN = 60_000

async function db(id = 'p200', difficulty: 'E' | 'M' | 'H' = 'M') {
  const d = freshDb()
  await d.tickets.put(mkTicket({ id, kind: 'problem', track: 'interview', difficulty, title: `${id.slice(1)} · Problem` }))
  return d
}
const open = (d: DojoDB, rung: HelpRung, cost: number, extra: Partial<Parameters<typeof recordRung>[1]> = {}) =>
  recordRung(d, { ticketId: 'p200', attemptStart: T0, cycleId: String(T0), rung, cost, at: T0 + 11 * MIN, ...extra })
async function close(d: DojoDB, outcome: Outcome, extra: Partial<Parameters<typeof closeLadderSession>[1]> = {}) {
  const r = await closeLadderSession(d, { ticketId: 'p200', outcome, attemptStart: T0, cycleId: String(T0), sessionStart: T0, now: T0 + 20 * MIN, netAtStart: 0, redoId: null, ...extra })
  if (!r.ok) throw new Error(r.message)
  return r
}
const xp = async (d: DojoDB, id = 'p200') => (await d.tickets.get(id))!.xp

describe('recordRung', () => {
  it('stores the output, writes a use and a rung event, raises deepestRung, keeps net 0 before a solve', async () => {
    const d = await db()
    const r = await open(d, 2, 2, { level: 1, output: { hint: { level: 1, text: '[fake:hint] x' } } })
    expect(r).toEqual({ xp: 0, delta: 0 })
    const t = (await d.tickets.get('p200'))!
    expect(t.ai?.hints).toEqual(['[fake:hint] x'])
    expect(t.deepestRung).toBe(2)
    expect(await d.rungUses.toArray()).toMatchObject([{ ticketId: 'p200', attemptStart: T0, cycleId: String(T0), rung: 2, cost: 2, applied: 2, refunded: 0, level: 1 }])
    expect((await d.events.toArray()).filter(e => e.t === 'rung')).toMatchObject([{ id: 'p200', rung: 2, cost: 2, applied: 2 }])
  })
})

describe('closeLadderSession', () => {
  it('H-16 Solved with help after one hint nets 8 and schedules nothing', async () => {
    const d = await db()
    await open(d, 2, 2)
    const r = await close(d, 'solved_help')
    expect(r).toMatchObject({ xpDelta: 8, net: 8, effect: { kind: 'none' }, session: { rungs: [1, 2], outcome: 'solved_help', xpDelta: 8 } })
    expect(await xp(d)).toBe(8)
    expect(await d.redos.count()).toBe(0)
  })

  it('the tick event records the net XP the ticket gets, not the gross base (10 base − 2 hint = 8)', async () => {
    const d = await db()
    await open(d, 2, 2)
    await close(d, 'solved_help')
    const ticks = (await d.events.toArray()).filter(e => e.t === 'tick')
    expect(ticks).toMatchObject([{ id: 'p200', xp: 8 }])
    expect(await xp(d)).toBe(8)
  })

  it('H-18 net floors at 0', async () => {
    const d = await db('p543', 'E')
    for (const [rung, cost] of [[2, 2], [3, 3], [4, 3]] as const) await recordRung(d, { ticketId: 'p543', attemptStart: T0, cycleId: String(T0), rung, cost, at: T0 })
    const r = await closeLadderSession(d, { ticketId: 'p543', outcome: 'solved_help', attemptStart: T0, cycleId: String(T0), sessionStart: T0, now: T0 + MIN, netAtStart: 0, redoId: null })
    expect(r).toMatchObject({ ok: true, xpDelta: 0, net: 0 })
  })

  it('H-25 Give up, then Solution: redo stage 0 due +3 d with C = 10, session extended', async () => {
    const d = await db()
    await open(d, 2, 2)
    await open(d, 3, 3)
    const g = await close(d, 'gave_up', { now: ist('2026-10-06T21:20:00') })
    if (g.effect.kind !== 'created') throw new Error('expected a created redo')
    expect(g.effect.redo).toMatchObject({ stage: 0, due: ist('2026-10-09T21:20:00'), helpCost: 5 })
    await recordRung(d, { ticketId: 'p200', attemptStart: T0, cycleId: String(T0), rung: 5, cost: 5, at: ist('2026-10-06T21:21:00'), afterGiveUp: { sessionId: g.session.id, redoId: g.effect.redo.id, countsTowardRedo: true, failedRedo: false } })
    expect(await d.redos.get(g.effect.redo.id)).toMatchObject({ helpCost: 10 })
    expect(await d.sessions.get(g.session.id)).toMatchObject({ rungs: [1, 2, 3, 5], outcome: 'gave_up', xpDelta: 0 })
    expect(await xp(d)).toBe(0)
  })

  async function givenUpWithC10(d: DojoDB) {
    await open(d, 2, 2)
    await open(d, 3, 3)
    const g = await close(d, 'gave_up', { now: ist('2026-10-06T21:20:00') })
    if (g.effect.kind !== 'created') throw new Error('expected a created redo')
    await recordRung(d, { ticketId: 'p200', attemptStart: T0, cycleId: String(T0), rung: 5, cost: 5, at: ist('2026-10-06T21:21:00'), afterGiveUp: { sessionId: g.session.id, redoId: g.effect.redo.id, countsTowardRedo: true, failedRedo: false } })
    return g.effect.redo.id
  }
  async function redoSession(d: DojoDB, redoId: string, at: string, outcome: Outcome, uses: Array<[HelpRung, number]> = []) {
    const s = ist(at)
    for (const [rung, cost] of uses) await recordRung(d, { ticketId: 'p200', attemptStart: s, cycleId: String(s), rung, cost, at: s + 11 * MIN, redoId })
    const r = await closeLadderSession(d, { ticketId: 'p200', outcome, attemptStart: s, cycleId: String(s), sessionStart: s, now: s + 20 * MIN, netAtStart: await xp(d), redoId })
    if (!r.ok) throw new Error(r.message)
    return r
  }

  it('H-28…H-30 passes refund floor(C/2), then the rest, then +3 and close the redo', async () => {
    const d = await db()
    const redoId = await givenUpWithC10(d)
    let r = await redoSession(d, redoId, '2026-10-09T00:01:00', 'solved')
    expect(r.effect).toMatchObject({ kind: 'pass', refund: 5, complete: false })
    expect(r.session.redoId).toBe(redoId)
    expect(await xp(d)).toBe(5)
    expect(await d.redos.get(redoId)).toMatchObject({ stage: 1, refunded: 5, due: ist('2026-10-19T00:21:00') })
    r = await redoSession(d, redoId, '2026-10-19T00:30:00', 'solved')
    expect(r.effect).toMatchObject({ kind: 'pass', refund: 5 })
    expect(await xp(d)).toBe(10)
    expect(await d.redos.get(redoId)).toMatchObject({ stage: 2, due: ist('2026-11-18T00:50:00') })
    r = await redoSession(d, redoId, '2026-11-18T01:00:00', 'solved')
    expect(r.effect).toMatchObject({ kind: 'pass', refund: 3, complete: true })
    expect(await xp(d)).toBe(13)
    expect((await d.redos.get(redoId))!.closedAt).toBeDefined()
    expect((await d.events.toArray()).filter(e => e.t === 'redo_pass')).toHaveLength(3)
  })

  it('H-31 a pass with one hint applies that cost: net 10 − 12 + 5 = 3', async () => {
    const d = await db()
    const redoId = await givenUpWithC10(d)
    const r = await redoSession(d, redoId, '2026-10-09T00:01:00', 'solved_help', [[2, 2]])
    expect(r.effect).toMatchObject({ kind: 'pass', refund: 5 })
    expect(await xp(d)).toBe(3)
  })

  it('H-32 a failed redo keeps the stage and un-applies its own costs: net 0', async () => {
    const d = await db()
    const redoId = await givenUpWithC10(d)
    const r = await redoSession(d, redoId, '2026-10-09T00:01:00', 'solved_help', [[2, 2], [3, 6]])
    expect(r.effect).toMatchObject({ kind: 'fail', days: 3 })
    expect(await xp(d)).toBe(0)
    expect(await d.redos.get(redoId)).toMatchObject({ stage: 0, helpCost: 10, due: ist('2026-10-12T00:21:00') })
    expect((await d.rungUses.toArray()).filter(u => u.attemptStart === ist('2026-10-09T00:01:00')).map(u => u.applied)).toEqual([0, 0])
    expect((await d.events.toArray()).filter(e => e.t === 'redo_fail')).toHaveLength(1)
  })

  it('H-34 a qualifying non-redo session resets a live redo to stage 0', async () => {
    const d = await db()
    const redoId = await givenUpWithC10(d)
    await redoSession(d, redoId, '2026-10-09T00:01:00', 'solved')
    const s = ist('2026-10-12T21:00:00')
    await recordRung(d, { ticketId: 'p200', attemptStart: s, cycleId: String(s), rung: 2, cost: 2, at: s })
    await recordRung(d, { ticketId: 'p200', attemptStart: s, cycleId: String(s), rung: 3, cost: 3, at: s })
    const r = await closeLadderSession(d, { ticketId: 'p200', outcome: 'gave_up', attemptStart: s, cycleId: String(s), sessionStart: s, now: s, netAtStart: await xp(d), redoId: null })
    expect(r).toMatchObject({ ok: true, effect: { kind: 'reset', redo: { id: redoId, stage: 0, helpCost: 5, refunded: 0, due: ist('2026-10-15T21:00:00') } } })
  })

  it('markUnderstood flags the session', async () => {
    const d = await db()
    const g = await close(d, 'gave_up')
    await markUnderstood(d, g.session.id)
    expect((await d.sessions.get(g.session.id))!.understood).toBe(true)
  })
})

describe('callJob', () => {
  it('logs every call, ok or not', async () => {
    const d = await db()
    const req = { ticket: { id: 'p200', title: 'Number of Islands', track: 'dsa' as const }, context: { level: 1 as const } }
    const ok = await callJob(d, 'hint', req as never, T0)
    expect(ok.ok).toBe(true)
    localStorage.setItem('dojo-ai-fake-fail', 'hint:busy')
    const bad = await callJob(d, 'hint', req as never, T0)
    expect(bad).toMatchObject({ ok: false, code: 'busy' })
    expect(await d.aiLog.toArray()).toMatchObject([{ job: 'hint', ok: true, ticketId: 'p200' }, { job: 'hint', ok: false, code: 'busy' }])
  })
})

describe('slideTicketsTo', () => {
  it('slides each id with one slide event each, and skips done tickets', async () => {
    const d = freshDb()
    await d.tickets.bulkPut([mkTicket({ id: 'a', sprint: 1 }), mkTicket({ id: 'b', sprint: 2 }), mkTicket({ id: 'c', sprint: 2, status: 'done' })])
    const r = await slideTicketsTo(d, ['a', 'b', 'c'], 3, T0, 2)
    expect(r).toEqual({ ok: true, xpDelta: 0, count: 2 })
    expect((await d.tickets.get('a'))!).toMatchObject({ sprint: 3, slidFrom: [1] })
    expect((await d.tickets.get('c'))!.sprint).toBe(2)
    expect((await d.events.toArray()).filter(e => e.t === 'slide')).toHaveLength(2)
  })
})

describe('closeLadderSession stores the study session\'s goal and focus minutes on a Solved / Give up row', () => {
  it('goal and focusMinutes land on the session; absent when there was no session', async () => {
    const d = await db()
    const r = await close(d, 'solved', { goal: '  trace it ', focusMinutes: 50 })
    expect(r.session).toMatchObject({ goal: 'trace it', focusMinutes: 50 })
    const d2 = await db()
    const r2 = await close(d2, 'solved')
    expect(r2.session).not.toHaveProperty('goal')
    expect(r2.session).not.toHaveProperty('focusMinutes')
  })
})

import { describe, expect, it } from 'vitest'
import { moveTicket } from '../../src/data/boardActions'
import { closeLadderSession, recordRung } from '../../src/data/ladderActions'
import type { Ticket } from '../../src/data/types'
import { totalXp } from '../../src/rules/xp'
import { freshDb, seededDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'

const NOW = 1_800_000_000_000

describe('moveTicket', () => {
  it('moves to Doing without writing an event', async () => {
    const d = await seededDb()
    expect(await moveTicket(d, 'p1', 'doing', NOW)).toEqual({ ok: true, xpDelta: 0 })
    expect((await d.tickets.get('p1'))!.status).toBe('doing')
    expect(await d.events.count()).toBe(0)
  })

  it('a fourth Doing ticket is allowed: Doing is a soft cap', async () => {
    const d = await seededDb()
    for (const id of ['m1w1t1', 'm1w2t1', 'm1w3t1']) await moveTicket(d, id, 'doing', NOW)
    expect(await moveTicket(d, 'p127', 'doing', NOW)).toEqual({ ok: true, xpDelta: 0 })
    expect((await d.tickets.get('p127'))!.status).toBe('doing')
  })

  it('ticks to Done with XP and one tick event, and unticks back', async () => {
    const d = await seededDb()
    expect(await moveTicket(d, 'p127', 'done', NOW)).toEqual({ ok: true, xpDelta: 15 })
    expect(await d.tickets.get('p127')).toMatchObject({ status: 'done', xp: 15, doneAt: NOW, doneAtApprox: false })
    expect(await d.events.toArray()).toMatchObject([{ t: 'tick', id: 'p127', at: NOW, xp: 15 }])

    expect(await moveTicket(d, 'p127', 'todo', NOW + 1)).toEqual({ ok: true, xpDelta: -15 })
    const t = (await d.tickets.get('p127'))!
    expect(t).toMatchObject({ status: 'todo', xp: 0 })
    expect(t.doneAt).toBeUndefined()
    expect(totalXp(await d.tickets.toArray())).toBe(0)
    expect((await d.events.toArray()).map(e => e.t)).toEqual(['tick', 'untick'])
  })

  it('unticks XP when a Done ticket moves to Doing, not just Todo (controller ruling #1, XP leak)', async () => {
    const d = await seededDb()
    expect(await moveTicket(d, 'p127', 'done', NOW)).toEqual({ ok: true, xpDelta: 15 })
    expect(await moveTicket(d, 'p127', 'doing', NOW + 1)).toEqual({ ok: true, xpDelta: -15 })
    const afterUntick = (await d.tickets.get('p127'))!
    expect(afterUntick).toMatchObject({ status: 'doing', xp: 0 })
    expect(afterUntick.doneAt).toBeUndefined()
    expect(afterUntick.doneAtApprox).toBeUndefined()
    expect(await moveTicket(d, 'p127', 'todo', NOW + 2)).toEqual({ ok: true, xpDelta: 0 })
    expect(totalXp(await d.tickets.toArray())).toBe(0)
    expect((await d.events.toArray()).map(e => e.t)).toEqual(['tick', 'untick'])

    // Re-solving pays again, and total XP rises correctly (no leak from the round trip).
    expect(await moveTicket(d, 'p127', 'done', NOW + 3)).toEqual({ ok: true, xpDelta: 15 })
    expect(totalXp(await d.tickets.toArray())).toBe(15)
    expect((await d.events.toArray()).map(e => e.t)).toEqual(['tick', 'untick', 'tick'])
  })

  it('I2 give-up -> Solution -> Board-done gives the net (one XP function), not the ticket\'s full base', async () => {
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'p200', kind: 'problem', track: 'interview', difficulty: 'M', title: 'Problem', status: 'todo' }))
    await recordRung(d, { ticketId: 'p200', attemptStart: NOW, cycleId: String(NOW), rung: 2, cost: 2, at: NOW + 1 })
    await recordRung(d, { ticketId: 'p200', attemptStart: NOW, cycleId: String(NOW), rung: 3, cost: 3, at: NOW + 2 })
    const g = await closeLadderSession(d, { ticketId: 'p200', outcome: 'gave_up', attemptStart: NOW, cycleId: String(NOW), sessionStart: NOW, now: NOW + 3, netAtStart: 0, redoId: null })
    if (!g.ok) throw new Error(g.message)
    if (g.effect.kind !== 'created') throw new Error('expected a created redo')
    await recordRung(d, {
      ticketId: 'p200', attemptStart: NOW, cycleId: String(NOW), rung: 5, cost: 5, at: NOW + 4,
      afterGiveUp: { sessionId: g.session.id, redoId: g.effect.redo.id, countsTowardRedo: true, failedRedo: false },
    })
    // Full applied help (2 + 3 + 5 = 10) already consumes the M-difficulty base of 10, so the net
    // once Done is 0 - moveTicket must NOT instead award the full base (which would be 10).
    const r = await moveTicket(d, 'p200', 'done', NOW + 5)
    expect(r).toEqual({ ok: true, xpDelta: 0 })
    expect(await d.tickets.get('p200')).toMatchObject({ status: 'done', xp: 0 })
  })

  it('cu-r2 A2#11: a study session closed with 0 focus minutes keeps focusMinutes 0, so it has its Earlier sessions row', async () => {
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'p200', kind: 'problem', track: 'interview', difficulty: 'M', title: 'Problem', status: 'todo' }))
    const g = await closeLadderSession(d, { ticketId: 'p200', outcome: 'solved', attemptStart: NOW, cycleId: String(NOW), sessionStart: NOW, now: NOW + 3, netAtStart: 0, redoId: null, goal: '', focusMinutes: 0 })
    if (!g.ok) throw new Error(g.message)
    expect(g.session.focusMinutes).toBe(0)
    const { isStudyRow } = await import('../../src/screens/do/study/SessionHistory')
    expect(isStudyRow((await d.sessions.toArray())[0])).toBe(true)
    expect(isStudyRow({ ...g.session, focusMinutes: undefined, goal: undefined })).toBe(false)
  })

  it('deletes a real bank/mine ticket on leaving Done (isBankOrigin), but not one with an unknown/missing origin', async () => {
    const d = await seededDb()
    const bank = mkTicket({ id: 'bank:blind75:p1', origin: 'bank:blind75', status: 'done', xp: 10 })
    const weird = mkTicket({ id: 'weird', origin: 'something-unexpected' as Ticket['origin'], status: 'done', xp: 10 })
    await d.tickets.bulkPut([bank, weird])

    expect(await moveTicket(d, 'bank:blind75:p1', 'todo', NOW)).toEqual({ ok: true, xpDelta: -10 })
    expect(await d.tickets.get('bank:blind75:p1')).toBeUndefined()

    // Unknown origin behaves like plan: payback XP and land on 'todo', never deleted.
    expect(await moveTicket(d, 'weird', 'todo', NOW)).toEqual({ ok: true, xpDelta: -10 })
    const t = await d.tickets.get('weird')
    expect(t).toMatchObject({ status: 'todo', xp: 0 })
    expect(t!.doneAt).toBeUndefined()
  })
})

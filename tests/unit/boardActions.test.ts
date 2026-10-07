import { describe, expect, it } from 'vitest'
import {
  moveOnBoard, moveTicket, shiftPlanAction, slideNext, slideSprintAction, slideTicketTo, undoLast,
} from '../../src/data/boardActions'
import { undoableSteps } from '../../src/rules/slide'
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

  it('rejects a 4th Doing ticket of a sprint and changes nothing (Review Focus #5)', async () => {
    const d = await seededDb()
    for (const id of ['m1w1t1', 'm1w2t1', 'm1w3t1']) await d.tickets.update(id, { sprint: 1 }) // the limit is per sprint (ruling 25 R2)
    for (const id of ['m1w1t1', 'm1w2t1', 'm1w3t1']) await moveTicket(d, id, 'doing', NOW)
    const before = await d.tickets.orderBy('id').toArray()
    const r = await moveTicket(d, 'p127', 'doing', NOW)
    expect(r).toMatchObject({ ok: false, reason: 'doing_full', message: expect.stringMatching(/^Doing is full \(3\/3\)/) })
    expect(await d.tickets.orderBy('id').toArray()).toEqual(before)
    expect(await d.events.count()).toBe(0)
  })

  it('counts Doing per sprint: three Doing cards in Sprint 2 never block Sprint 1 (UAT cu-3p P2-2, ruling 25 R2)', async () => {
    const d = await seededDb()
    for (const id of ['m1w1t1', 'm1w2t1', 'm1w3t1']) await d.tickets.update(id, { sprint: 2 })
    for (const id of ['m1w1t1', 'm1w2t1', 'm1w3t1']) expect(await moveTicket(d, id, 'doing', NOW)).toEqual({ ok: true, xpDelta: 0 })
    // Sprint 1 has no Doing card at all: its cards go to Doing, up to three
    expect(await moveTicket(d, 'p127', 'doing', NOW)).toEqual({ ok: true, xpDelta: 0 })
    // Sprint 2 is full: a fourth card there is refused, and nothing changes
    await d.tickets.update('p200', { sprint: 2 })
    const before = await d.tickets.orderBy('id').toArray()
    expect(await moveTicket(d, 'p200', 'doing', NOW)).toMatchObject({ ok: false, reason: 'doing_full' })
    expect(await d.tickets.orderBy('id').toArray()).toEqual(before)
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

describe('slides write exactly one event per action', () => {
  it('slideNext and slideTicketTo', async () => {
    const d = await seededDb()
    expect(await slideNext(d, 'm1w1t1', NOW, 1)).toEqual({ ok: true, xpDelta: 0 })
    expect(await d.tickets.get('m1w1t1')).toMatchObject({ sprint: 2, slidFrom: [1] })
    expect(await slideTicketTo(d, 'm1w3t1', 1, NOW, 2)).toMatchObject({ ok: false, reason: 'backwards' })
    expect(await d.events.count()).toBe(1)
  })

  it('slide sprint and shift plan', async () => {
    const d = await seededDb()
    expect(await slideSprintAction(d, 1, NOW, 1)).toEqual({ ok: true, xpDelta: 0, count: 5 })
    expect(await d.events.count()).toBe(1)
    expect(await shiftPlanAction(d, 1, NOW, 2)).toEqual({ ok: true, xpDelta: 0, count: 10 })
    expect(await d.events.count()).toBe(2)
    expect((await d.tickets.get('m1w1t1'))!.sprint).toBe(3)
    expect(await slideSprintAction(d, 1, NOW, 1)).toMatchObject({ ok: false, reason: 'empty' })
  })
})

// UAT r3 J7: dragging Rebuild to Doing (or Shift+→) left "Undo (0)"
describe('Board column moves are undoable', () => {
  it('a move to Doing is one undo step, and Undo puts the card back in Todo', async () => {
    const d = await seededDb()
    expect(await moveOnBoard(d, 'p1', 'doing', NOW)).toEqual({ ok: true, xpDelta: 0 })
    expect(undoableSteps(await d.events.toArray())).toHaveLength(1)
    expect(await undoLast(d, NOW + 1)).toEqual({ ok: true, xpDelta: 0, count: 1 })
    expect((await d.tickets.get('p1'))!.status).toBe('todo')
    expect(undoableSteps(await d.events.toArray())).toHaveLength(0)
  })

  it('undoing a move to Done takes its XP back; undoing a move out of Done gives it back', async () => {
    const d = await seededDb()
    expect(await moveOnBoard(d, 'p127', 'done', NOW)).toEqual({ ok: true, xpDelta: 15 })
    expect(await undoLast(d, NOW + 1)).toEqual({ ok: true, xpDelta: -15, count: 1 })
    expect(await d.tickets.get('p127')).toMatchObject({ status: 'todo', xp: 0 })
    await moveOnBoard(d, 'p127', 'done', NOW + 2)
    await moveOnBoard(d, 'p127', 'doing', NOW + 3)
    expect((await d.tickets.get('p127'))!.xp).toBe(0)
    expect(await undoLast(d, NOW + 4)).toMatchObject({ ok: true, xpDelta: 15 })
    expect(await d.tickets.get('p127')).toMatchObject({ status: 'done', xp: 15 })
  })

  it('a refused move records nothing; an undo whose card has moved on since changes nothing', async () => {
    const d = await seededDb()
    for (const id of ['m1w1t1', 'm1w2t1', 'm1w3t1']) await d.tickets.update(id, { sprint: 1 })
    for (const id of ['m1w1t1', 'm1w2t1', 'm1w3t1']) await moveOnBoard(d, id, 'doing', NOW)
    expect((await moveOnBoard(d, 'p127', 'doing', NOW)).ok).toBe(false)
    expect(undoableSteps(await d.events.toArray())).toHaveLength(3)
    await moveTicket(d, 'm1w3t1', 'todo', NOW + 1) // moved back some other way
    expect(await undoLast(d, NOW + 2)).toEqual({ ok: true, xpDelta: 0, count: 1 })
    expect((await d.tickets.get('m1w3t1'))!.status).toBe('todo')
    expect(undoableSteps(await d.events.toArray())).toHaveLength(2)
  })
})

describe('undoLast', () => {
  it('restores prior state LIFO and records undo events', async () => {
    const d = await seededDb()
    const original = await d.tickets.orderBy('id').toArray()
    await slideSprintAction(d, 1, NOW, 1)
    await shiftPlanAction(d, 2, NOW, 1)
    expect(await undoLast(d, NOW)).toMatchObject({ ok: true })
    expect(await undoLast(d, NOW)).toMatchObject({ ok: true })
    expect(await d.tickets.orderBy('id').toArray()).toEqual(original)
    expect((await d.events.toArray()).map(e => e.t)).toEqual(['slide_sprint', 'shift_plan', 'undo', 'undo'])
    expect(await undoLast(d, NOW)).toEqual({ ok: false, reason: 'nothing', message: 'Nothing to undo' })
  })

  it('reaches back at most 20 slide events', async () => {
    const d = await seededDb()
    for (let i = 0; i < 21; i++) await slideNext(d, 'm1w1t1', NOW, 1)
    expect((await d.tickets.get('m1w1t1'))!.sprint).toBe(22)
    for (let i = 0; i < 20; i++) expect((await undoLast(d, NOW)).ok).toBe(true)
    expect(await undoLast(d, NOW)).toMatchObject({ ok: false, reason: 'nothing' })
    expect(await d.tickets.get('m1w1t1')).toMatchObject({ sprint: 2, slidFrom: [1] })
  })
})

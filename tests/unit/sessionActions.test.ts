import { describe, expect, it } from 'vitest'
import { closeSession, endStudySession, END_LOG_MAX, recordFocus, startDoing } from '../../src/data/sessionActions'
import { totalXp } from '../../src/rules/xp'
import { outcomesBySprint } from '../../src/rules/progress'
import { patchSettings } from '../../src/data/db'
import { runReconcile } from '../../src/data/seed'
import { activityByDay } from '../../src/rules/calendar'
import { failingDb, seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const NOW = ist('2026-09-14T22:00:00')

describe('startDoing', () => {
  it('moves todo → doing and is a no-op for doing/done', async () => {
    const d = await seededDb()
    expect(await startDoing(d, 'p127', NOW)).toEqual({ ok: true, xpDelta: 0 })
    expect((await d.tickets.get('p127'))!.status).toBe('doing')
    expect(await startDoing(d, 'p127', NOW)).toEqual({ ok: true, xpDelta: 0 })
    await d.tickets.update('p1', { status: 'done' })
    expect(await startDoing(d, 'p1', NOW)).toEqual({ ok: true, xpDelta: 0 })
    expect((await d.tickets.get('p1'))!.status).toBe('done')
  })

  it('rejects a 4th Doing ticket from the Do screen and changes nothing (Review Focus #5)', async () => {
    const d = await seededDb()
    for (const id of ['m1w1t1', 'm1w2t1', 'm1w3t1']) await d.tickets.update(id, { sprint: 1 }) // the limit is per sprint (ruling 25 R2)
    for (const id of ['m1w1t1', 'm1w2t1', 'm1w3t1']) await startDoing(d, id, NOW)
    const before = await d.tickets.orderBy('id').toArray()
    const r = await startDoing(d, 'p127', NOW)
    expect(r).toMatchObject({ ok: false, reason: 'doing_full' })
    expect(await d.tickets.orderBy('id').toArray()).toEqual(before)
    expect(await d.events.count()).toBe(0)
  })
})

describe('closeSession', () => {
  it('Solved writes the session, the tick, and the done ticket', async () => {
    const d = await seededDb()
    await startDoing(d, 'p127', NOW)
    const r = await closeSession(d, 'p127', 'solved', { sessionStart: NOW - 30 * 60_000, now: NOW, notes: 'two-ended BFS', sessionId: 's1' })
    expect(r).toMatchObject({ ok: true, xpDelta: 15 })
    expect(await d.sessions.get('s1')).toEqual({
      id: 's1', ticketId: 'p127', start: NOW - 30 * 60_000, end: NOW, minutes: 30, outcome: 'solved', xpDelta: 15, notes: 'two-ended BFS',
    })
    expect(await d.tickets.get('p127')).toMatchObject({ status: 'done', xp: 15, doneAt: NOW })
    expect(await d.events.toArray()).toMatchObject([{ t: 'tick', id: 'p127', xp: 15 }])
  })

  it('Give up writes a session and returns the ticket to todo', async () => {
    const d = await seededDb()
    await startDoing(d, 'p127', NOW)
    const r = await closeSession(d, 'p127', 'gave_up', { sessionStart: NOW - 60_000, now: NOW })
    expect(r).toMatchObject({ ok: true, xpDelta: 0 })
    expect((await d.tickets.get('p127'))!.status).toBe('todo')
    expect(await d.sessions.count()).toBe(1)
    expect(await d.events.count()).toBe(0)
  })

  it('records a midnight/sprint-crossing session on its start day (Review Focus #3)', async () => {
    const d = await seededDb()
    const start = ist('2026-09-20T23:40:00')
    await closeSession(d, 'p127', 'solved', { sessionStart: start, now: ist('2026-09-21T00:30:00'), sessionId: 's1' })
    const sessions = await d.sessions.toArray()
    expect(sessions[0].start).toBe(start)
    expect(Object.fromEntries(activityByDay(await d.tickets.toArray(), sessions))).toEqual({ '2026-09-20': 1 })
  })

  it('reports a missing ticket without writing', async () => {
    const d = await seededDb()
    expect(await closeSession(d, 'nope', 'solved', { sessionStart: NOW, now: NOW })).toMatchObject({ ok: false, reason: 'missing' })
    expect(await d.sessions.count()).toBe(0)
  })

  it('refuses to close a session on an archived ticket, writing nothing (deferred integration item)', async () => {
    const d = await seededDb()
    await d.tickets.update('p127', { archived: true })
    const r = await closeSession(d, 'p127', 'solved', { sessionStart: NOW, now: NOW })
    expect(r).toMatchObject({ ok: false, reason: 'archived' })
    expect(await d.sessions.count()).toBe(0)
    expect(await d.events.count()).toBe(0)
    expect((await d.tickets.get('p127'))!.status).toBe('todo')
  })

  it('writes nothing if any part of the close fails', async () => {
    const d = failingDb('events')
    await runReconcile(d, smallPlan)
    await patchSettings(d, { startDate: '2026-09-07' })
    await expect(closeSession(d, 'p127', 'solved', { sessionStart: NOW, now: NOW })).rejects.toThrow('boom')
    expect(await d.sessions.count()).toBe(0)
    expect((await d.tickets.get('p127'))!.status).toBe('todo')
  })
})

describe('study session data (ux spec: focus is a health signal, never XP)', () => {
  it('recordFocus stores a focus event and changes no ticket, xp or session', async () => {
    const d = await seededDb()
    const before = await d.tickets.orderBy('id').toArray()
    await recordFocus(d, { ticketId: 'p127', at: NOW, minutes: 25 })
    const evs = await d.events.toArray()
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ t: 'focus', id: 'p127', at: NOW, minutes: 25 })
    expect(await d.tickets.orderBy('id').toArray()).toEqual(before)
    expect(totalXp(await d.tickets.toArray())).toBe(totalXp(before))
    expect(await d.sessions.count()).toBe(0)
  })

  it('endStudySession writes one studied session with the end log, xpDelta 0, and leaves the ticket alone', async () => {
    const d = await seededDb()
    await startDoing(d, 'p127', NOW)
    const before = await d.tickets.get('p127')
    const xpBefore = totalXp(await d.tickets.toArray())
    const r = await endStudySession(d, {
      ticketId: 'p127', start: NOW - 50 * 60_000, now: NOW, goal: 'trace two pointers', cards: ['p127'], focusMinutes: 50,
      endLog: { done: 'the loop', stuckOn: '', nextStep: 'edge cases' }, sessionId: 'sx1',
    })
    expect(r).toMatchObject({ ok: true })
    expect(await d.sessions.get('sx1')).toEqual({
      id: 'sx1', ticketId: 'p127', start: NOW - 50 * 60_000, end: NOW, minutes: 50, outcome: 'studied', xpDelta: 0,
      goal: 'trace two pointers', cards: ['p127'], focusMinutes: 50,
      endLog: { done: 'the loop', stuckOn: '', nextStep: 'edge cases' },
    })
    expect(await d.tickets.get('p127')).toEqual(before)
    expect(totalXp(await d.tickets.toArray())).toBe(xpBefore)
    expect((await d.events.toArray()).filter(e => e.t === 'tick')).toHaveLength(0)
  })

  it('trims each end-log text and caps it at 280 characters', async () => {
    const d = await seededDb()
    await endStudySession(d, {
      ticketId: 'p127', start: NOW - 60_000, now: NOW, cards: ['p127'], focusMinutes: 0, sessionId: 'sx2',
      endLog: { done: `  ${'a'.repeat(400)}  `, stuckOn: '  b ', nextStep: '' },
    })
    const s = (await d.sessions.get('sx2'))!
    expect(s.endLog!.done).toHaveLength(END_LOG_MAX)
    expect(s.endLog!.stuckOn).toBe('b')
    expect(s.endLog!.nextStep).toBe('')
  })

  it('refuses a missing ticket and writes nothing', async () => {
    const d = await seededDb()
    const r = await endStudySession(d, { ticketId: 'nope', start: NOW - 1, now: NOW, cards: [], focusMinutes: 0, endLog: { done: '', stuckOn: '', nextStep: '' } })
    expect(r).toMatchObject({ ok: false, reason: 'missing' })
    expect(await d.sessions.count()).toBe(0)
  })

  it('a studied session is not an outcome column in Progress', () => {
    const s = { id: 'a', ticketId: 'p1', start: NOW, end: NOW, minutes: 1, outcome: 'studied' as const, xpDelta: 0 }
    expect(outcomesBySprint([s], '2026-09-07')).toEqual([])
  })

  it('recordFocus is idempotent per {sid, block}: a second tab crediting the same block adds nothing', async () => {
    const d = await seededDb()
    await recordFocus(d, { ticketId: 'p127', at: NOW, minutes: 25, sid: 'st1', block: 1 })
    await recordFocus(d, { ticketId: 'p127', at: NOW, minutes: 25, sid: 'st1', block: 1 })
    await Promise.all([1, 2, 3].map(() => recordFocus(d, { ticketId: 'p127', at: NOW, minutes: 25, sid: 'st1', block: 1 })))
    await recordFocus(d, { ticketId: 'p127', at: NOW + 1, minutes: 25, sid: 'st1', block: 2 })
    const evs = (await d.events.toArray()).filter(e => e.t === 'focus')
    expect(evs.map(e => (e as { block?: number }).block).sort()).toEqual([1, 2])
  })

  it('endStudySession with the same session id twice writes one row and reports the duplicate', async () => {
    const d = await seededDb()
    const i = { ticketId: 'p127', start: NOW - 60_000, now: NOW, cards: ['p127'], focusMinutes: 0, endLog: { done: 'a' }, sessionId: 'dup' }
    expect(await endStudySession(d, i)).toMatchObject({ ok: true })
    expect(await endStudySession(d, i)).toMatchObject({ ok: false, reason: 'duplicate' })
    expect(await d.sessions.count()).toBe(1)
  })
})


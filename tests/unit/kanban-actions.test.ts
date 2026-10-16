import { describe, expect, it } from 'vitest'
import { moveTicket } from '../../src/data/boardActions'
import { finishProblem, saveBlockedNote } from '../../src/data/kanbanActions'
import { startDoing } from '../../src/data/sessionActions'
import type { Ticket } from '../../src/data/types'
import { freshDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'

const NOW = new Date('2026-11-04T10:00:00+05:30').getTime()
const seed = async (extra: Partial<Ticket>[] = []) => {
  const d = freshDb()
  await d.tickets.bulkAdd([
    mkTicket({ id: 'a', lane: 'path', kind: 'watch', order: 1, orderOverride: 0.5 }),
    mkTicket({ id: 'b', lane: 'path', kind: 'watch', order: 2, status: 'blocked', blockedNote: 'Waiting for GPU quota' }),
    mkTicket({ id: 'c', lane: 'path', kind: 'build', order: 3, status: 'help' }),
    mkTicket({ id: 'd', lane: 'dsa', kind: 'problem', order: 4, difficulty: 'M', track: 'interview' }),
    mkTicket({ id: 'e', lane: 'path', kind: 'watch', order: 5, status: 'doing' }),
    ...extra.map((x, i) => mkTicket({ id: `x${i}`, ...x })),
  ])
  return d
}
const snapshot = async (d: Awaited<ReturnType<typeof seed>>) => JSON.stringify(await d.tickets.orderBy('id').toArray())

describe('moving a card writes only that ticket (BOARD-32, the Transitions table)', () => {
  it('todo to blocked sets the status, keeps order and orderOverride, writes no note, no session, no event', async () => {
    const d = await seed()
    const before = await d.tickets.get('a')
    const r = await moveTicket(d, 'a', 'blocked', NOW)
    expect(r).toMatchObject({ ok: true, xpDelta: 0 })
    const a = (await d.tickets.get('a'))!
    expect(a).toEqual({ ...before, status: 'blocked' })
    expect('blockedNote' in a).toBe(false)
    expect(await d.sessions.count()).toBe(0)
    expect(await d.events.count()).toBe(0)
  })
  it('blocked to help keeps the note; help to blocked keeps it; a note-less one stays note-less', async () => {
    const d = await seed()
    await moveTicket(d, 'b', 'help', NOW)
    expect(await d.tickets.get('b')).toMatchObject({ status: 'help', blockedNote: 'Waiting for GPU quota' })
    await moveTicket(d, 'b', 'blocked', NOW)
    expect(await d.tickets.get('b')).toMatchObject({ status: 'blocked', blockedNote: 'Waiting for GPU quota' })
    await moveTicket(d, 'c', 'blocked', NOW)
    expect('blockedNote' in (await d.tickets.get('c'))!).toBe(false)
  })
  it('to doing or todo removes the note and leaves everything else (BOARD-22, BOARD-23)', async () => {
    const d = await seed()
    await moveTicket(d, 'b', 'doing', NOW)
    const b = (await d.tickets.get('b'))!
    expect(b.status).toBe('doing')
    expect('blockedNote' in b).toBe(false)
    await moveTicket(d, 'e', 'todo', NOW)
    expect((await d.tickets.get('e'))!.status).toBe('todo')
    await moveTicket(d, 'c', 'todo', NOW)
    expect((await d.tickets.get('c'))!.status).toBe('todo')
  })
  it('Start (startDoing) on a blocked ticket makes it doing and clears the note, order untouched (PATH-33, TICKET-38)', async () => {
    const d = await seed()
    await startDoing(d, 'b', NOW)
    const b = (await d.tickets.get('b'))!
    expect(b).toMatchObject({ status: 'doing', order: 2 })
    expect('blockedNote' in b).toBe(false)
  })
  it('a move to the status it has changes nothing', async () => {
    const d = await seed()
    const before = await snapshot(d)
    expect(await moveTicket(d, 'b', 'blocked', NOW)).toMatchObject({ ok: false, reason: 'same' })
    expect(await snapshot(d)).toBe(before)
  })
  it('Done from a blocked ticket is a normal done: doneAt, xp, a tick event, no note', async () => {
    const d = await seed()
    const r = await moveTicket(d, 'b', 'done', NOW)
    expect(r).toMatchObject({ ok: true, xpDelta: 10 })
    const b = (await d.tickets.get('b'))!
    expect(b).toMatchObject({ status: 'done', doneAt: NOW, xp: 10 })
    expect('blockedNote' in b).toBe(false)
    expect(await d.events.count()).toBe(1)
  })
})

describe('the reason (BOARD-20, BOARD-21)', () => {
  it('saves the trimmed text on a blocked ticket and nothing else changes', async () => {
    const d = await seed()
    const before = (await d.tickets.get('c'))!
    expect(await saveBlockedNote(d, 'c', '  Waiting for the lab key ')).toMatchObject({ ok: true })
    expect(await d.tickets.get('c')).toEqual({ ...before, blockedNote: 'Waiting for the lab key' })
  })
  it('stores at most 140 characters', async () => {
    const d = await seed()
    await saveBlockedNote(d, 'c', 'y'.repeat(160))
    expect((await d.tickets.get('c'))!.blockedNote).toHaveLength(140)
  })
  it('a blank save writes nothing, and removes an existing note', async () => {
    const d = await seed()
    const before = await snapshot(d)
    await saveBlockedNote(d, 'c', '   ')
    expect(await snapshot(d)).toBe(before)
    await saveBlockedNote(d, 'b', '   ')
    expect('blockedNote' in (await d.tickets.get('b'))!).toBe(false)
  })
  it('refuses a ticket that is not blocked or need-help', async () => {
    const d = await seed()
    const before = await snapshot(d)
    expect(await saveBlockedNote(d, 'a', 'nope')).toMatchObject({ ok: false })
    expect(await snapshot(d)).toBe(before)
  })
})

describe('a problem finished from the Board (BOARD-25 to BOARD-27)', () => {
  it('solved: done, XP by difficulty, one solved session, no redo', async () => {
    const d = await seed()
    const r = await finishProblem(d, 'd', 'solved', NOW)
    expect(r).toMatchObject({ ok: true })
    expect(await d.tickets.get('d')).toMatchObject({ status: 'done', doneAt: NOW, xp: 10 })
    const s = await d.sessions.toArray()
    expect(s).toHaveLength(1)
    expect(s[0]).toMatchObject({ ticketId: 'd', outcome: 'solved', xpDelta: 10 })
    expect(await d.redos.count()).toBe(0)
  })
  it('solved with help (no rung opened): the same XP, outcome solved_help, no redo', async () => {
    const d = await seed()
    await finishProblem(d, 'd', 'solved_help', NOW)
    expect(await d.tickets.get('d')).toMatchObject({ status: 'done', xp: 10 })
    expect((await d.sessions.toArray())[0]).toMatchObject({ outcome: 'solved_help', xpDelta: 10 })
    expect(await d.redos.count()).toBe(0)
  })
  it('gave up: not done, from blocked too, no note, a gave_up session and an open redo three days out', async () => {
    const d = await seed([{ lane: 'dsa', kind: 'problem', difficulty: 'E', status: 'blocked', blockedNote: 'x', order: 9 }])
    const r = await finishProblem(d, 'x0', 'gave_up', NOW)
    expect(r).toMatchObject({ ok: true })
    const t = (await d.tickets.get('x0'))!
    expect(t).toMatchObject({ status: 'todo', xp: 0 })
    expect('doneAt' in t).toBe(false)
    expect('blockedNote' in t).toBe(false)
    expect((await d.sessions.toArray())[0]).toMatchObject({ outcome: 'gave_up', xpDelta: 0 })
    const redos = await d.redos.toArray()
    expect(redos).toHaveLength(1)
    expect(redos[0]).toMatchObject({ ticketId: 'x0', source: 'gave_up', stage: 0 })
    expect(redos[0].closedAt).toBeUndefined()
    expect(new Date(redos[0].due as number).toDateString()).toBe(new Date(NOW + 3 * 86_400_000).toDateString())
  })
  it('a repeated Gave up resets the one open gave_up redo (stage 0, due three days out) and writes no second one; every give-up writes its session', async () => {
    const d = await seed()
    await finishProblem(d, 'd', 'gave_up', NOW)
    const first = (await d.redos.toArray())[0]
    await d.redos.update(first.id, { stage: 1 })
    const later = NOW + 5 * 86_400_000
    await finishProblem(d, 'd', 'gave_up', later)
    const redos = await d.redos.toArray()
    expect(redos).toHaveLength(1)
    expect(redos[0]).toMatchObject({ id: first.id, stage: 0, source: 'gave_up' })
    expect(new Date(redos[0].due as number).toDateString()).toBe(new Date(later + 3 * 86_400_000).toDateString())
    expect((await d.sessions.toArray()).filter(s => s.outcome === 'gave_up')).toHaveLength(2)
  })
  it('an unknown or finished ticket is refused and nothing is written', async () => {
    const d = await seed()
    expect(await finishProblem(d, 'nope', 'solved', NOW)).toMatchObject({ ok: false })
    await finishProblem(d, 'd', 'solved', NOW)
    expect(await finishProblem(d, 'd', 'solved', NOW + 1000)).toMatchObject({ ok: false })
    expect(await d.sessions.count()).toBe(1)
  })
})

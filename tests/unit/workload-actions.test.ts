import { describe, expect, it } from 'vitest'
import { getSettings, patchSettings } from '../../src/data/db'
import { splitIntoSessions } from '../../src/data/splitActions'
import { applyRebalance, CORE_MINUTES_ERROR, moveToSprint, runRollover, saveCoreMinutes, setPinned } from '../../src/data/workloadActions'
import { undoLast } from '../../src/data/boardActions'
import { undoableSteps } from '../../src/rules/slide'
import { totalXp } from '../../src/rules/xp'
import { freshDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()

async function db() {
  const d = freshDb()
  await patchSettings(d, { startDate: '2026-10-05', trackedFrom: 1 })
  await d.tickets.bulkPut([
    mkTicket({ id: 'a', sprint: 1, order: 1 }), mkTicket({ id: 'b', sprint: 1, order: 2, status: 'doing' }),
    mkTicket({ id: 'done', sprint: 1, order: 3, status: 'done', xp: 10, doneAt: at(2026, 10, 7) }), mkTicket({ id: 'later', sprint: 3, order: 4 }),
  ])
  return d
}

describe('runRollover', () => {
  it('BR-10: past the end of sprint 1 the unfinished cards move to sprint 2 with rolledFrom [1]; XP unchanged; one rolled event for the run', async () => {
    const d = await db()
    const xpBefore = totalXp(await d.tickets.toArray())
    expect(await runRollover(d, at(2026, 10, 19, 8))).toBe(2)
    const ts = Object.fromEntries((await d.tickets.toArray()).map(t => [t.id, t]))
    expect(ts.a).toMatchObject({ sprint: 2, rolledFrom: [1], status: 'todo' })
    expect(ts.b).toMatchObject({ sprint: 2, rolledFrom: [1], status: 'doing' })
    expect(ts.done).toMatchObject({ sprint: 1, status: 'done' })
    expect(ts.later.sprint).toBe(3)
    expect(totalXp(Object.values(ts))).toBe(xpBefore)
    expect((await d.events.toArray()).filter(e => e.t === 'rolled')).toMatchObject([{ t: 'rolled', at: at(2026, 10, 19, 8), to: 2, ids: ['a', 'b'] }])
  })
  it('is safe to run twice, and does nothing while the sprint is still on', async () => {
    const d = await db()
    expect(await runRollover(d, at(2026, 10, 18, 23))).toBe(0)
    expect(await runRollover(d, at(2026, 10, 19, 8))).toBe(2)
    expect(await runRollover(d, at(2026, 10, 19, 9))).toBe(0)
    expect((await d.events.toArray()).filter(e => e.t === 'rolled')).toHaveLength(1)
  })
  it('rolled cards keep counting as left behind from their home sprint (carry), so Today and the Load check read as before', async () => {
    const d = await db()
    await runRollover(d, at(2026, 10, 19, 8))
    const a = (await d.tickets.get('a'))!
    expect(a.carry).toEqual({ home: 1, into: 2 })
    await runRollover(d, at(2026, 11, 3, 8)) // sprint 3: rolls again, home stays sprint 1
    expect((await d.tickets.get('a'))).toMatchObject({ sprint: 3, rolledFrom: [1, 2], carry: { home: 1, into: 3 } })
  })
  it('a plan tracked from sprint 2 (a late start) never rolls the sprints that had already ended', async () => {
    const d = await db()
    await patchSettings(d, { trackedFrom: 2 })
    expect(await runRollover(d, at(2026, 10, 19, 8))).toBe(0)
    expect((await d.tickets.get('a'))!.sprint).toBe(1)
  })
  it('a start date saved before tracking was recorded starts tracking at the sprint of the first look, and rolls nothing then', async () => {
    const d = freshDb()
    await patchSettings(d, { startDate: '2026-10-05' })
    await d.tickets.put(mkTicket({ id: 'a', sprint: 1 }))
    expect(await runRollover(d, at(2026, 10, 20, 8))).toBe(0)
    expect((await getSettings(d)).trackedFrom).toBe(2)
    expect((await d.tickets.get('a'))!.sprint).toBe(1)
  })
  it('does nothing before onboarding sets a start date', async () => {
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'a', sprint: 1 }))
    expect(await runRollover(d, at(2026, 10, 19))).toBe(0)
  })
})

describe('moveToSprint', () => {
  it('BR-12: moves an unfinished card and logs it', async () => {
    const d = await db()
    expect(await moveToSprint(d, 'a', 4, 5)).toEqual({ ok: true, count: 1 })
    expect((await d.tickets.get('a'))!.sprint).toBe(4)
    expect((await d.events.toArray()).at(-1)).toMatchObject({ t: 'moved', id: 'a', from: 1, to: 4, why: 'manual' })
  })
  it('refuses a finished card, the same sprint, a bad number and a missing card', async () => {
    const d = await db()
    expect(await moveToSprint(d, 'done', 2, 5)).toMatchObject({ ok: false })
    expect(await moveToSprint(d, 'a', 1, 5)).toEqual({ ok: false, message: 'Already in Sprint 1' })
    expect(await moveToSprint(d, 'a', 0, 5)).toMatchObject({ ok: false })
    expect(await moveToSprint(d, 'a', 2.5, 5)).toMatchObject({ ok: false })
    expect(await moveToSprint(d, 'nope', 2, 5)).toEqual({ ok: false, message: 'Ticket not found' })
    expect((await d.tickets.get('a'))!.sprint).toBe(1)
  })
  it('a hand move drops a stale carry so the card counts where it now is', async () => {
    const d = await db()
    await runRollover(d, at(2026, 10, 19, 8))
    expect((await d.tickets.get('a'))!.carry).toBeDefined()
    await moveToSprint(d, 'a', 2 + 1, 5)
    expect((await d.tickets.get('a'))!).not.toHaveProperty('carry')
    await d.tickets.put(mkTicket({ id: 'r', sprint: 1, carry: { home: 1, into: 1 } }))
    await applyRebalance(d, ['r'], 1, 2, 9)
    expect((await d.tickets.get('r'))!).not.toHaveProperty('carry')
  })
  it('a split container rolls over with its sessions', async () => {
    const d = await db()
    await splitIntoSessions(d, 'a', 2)
    await runRollover(d, at(2026, 10, 19, 8))
    expect((await d.tickets.toArray()).filter(t => t.id.startsWith('a')).map(t => t.sprint)).toEqual([2, 2, 2])
  })
  it('a split card takes its unfinished sessions along', async () => {
    const d = await db()
    await splitIntoSessions(d, 'a', 2)
    expect(await moveToSprint(d, 'a', 3, 5)).toEqual({ ok: true, count: 3 })
    expect((await d.tickets.toArray()).filter(t => t.id.startsWith('a')).map(t => t.sprint)).toEqual([3, 3, 3])
  })
})

describe('UAT J7: Undo counts card moves', () => {
  it('a hand move is one undo step; Undo puts the card back', async () => {
    const d = await db()
    await moveToSprint(d, 'a', 4, 5)
    expect(undoableSteps(await d.events.toArray())).toHaveLength(1)
    expect(await undoLast(d, 6)).toMatchObject({ ok: true, count: 1 })
    expect((await d.tickets.get('a'))!.sprint).toBe(1)
    expect(undoableSteps(await d.events.toArray())).toHaveLength(0)
  })
  it('a split card and its sessions move and come back as one step', async () => {
    const d = await db()
    await splitIntoSessions(d, 'a', 2)
    await moveToSprint(d, 'a', 3, 5)
    // ruling 20 S6: the split is a step of its own, under the move
    expect(undoableSteps(await d.events.toArray()).map(s => s[0].t)).toEqual(['moved', 'split'])
    expect(await undoLast(d, 6)).toMatchObject({ ok: true, count: 3 })
    expect((await d.tickets.toArray()).filter(t => t.id.startsWith('a')).map(t => t.sprint)).toEqual([1, 1, 1])
    expect(await undoLast(d, 7)).toMatchObject({ ok: true, count: 1 })
    expect((await d.tickets.toArray()).filter(t => t.id.startsWith('a')).map(t => t.id)).toEqual(['a'])
    expect(await undoLast(d, 8)).toMatchObject({ ok: false, reason: 'nothing' })
  })
  it('an accepted rebalance is one step; two moves are two, newest undone first', async () => {
    const d = await db()
    await applyRebalance(d, ['a', 'b'], 1, 2, 9)
    await moveToSprint(d, 'later', 5, 10)
    expect(undoableSteps(await d.events.toArray())).toHaveLength(2)
    await undoLast(d, 11)
    expect((await d.tickets.get('later'))!.sprint).toBe(3)
    expect((await d.tickets.get('a'))!.sprint).toBe(2)
    await undoLast(d, 12)
    expect([(await d.tickets.get('a'))!.sprint, (await d.tickets.get('b'))!.sprint]).toEqual([1, 1])
  })
  it('skips a card that was finished or moved again since', async () => {
    const d = await db()
    await moveToSprint(d, 'a', 4, 5)
    await d.tickets.update('a', { status: 'done' })
    expect(await undoLast(d, 6)).toMatchObject({ ok: true, count: 0 })
    expect((await d.tickets.get('a'))!.sprint).toBe(4)
  })
})

describe('rebalance and pin', () => {
  it('accepting moves exactly the given cards; pinned, moved-away and finished cards are skipped', async () => {
    const d = await db()
    await d.tickets.bulkPut([mkTicket({ id: 'p', sprint: 1, pinned: true }), mkTicket({ id: 'x', sprint: 2 })])
    expect(await applyRebalance(d, ['a', 'p', 'x', 'done', 'nope'], 1, 2, 9)).toEqual({ ok: true, count: 1 })
    const ts = Object.fromEntries((await d.tickets.toArray()).map(t => [t.id, t.sprint]))
    expect(ts).toMatchObject({ a: 2, p: 1, x: 2, done: 1 })
    expect((await d.events.toArray()).filter(e => e.t === 'moved')).toMatchObject([{ id: 'a', from: 1, to: 2, why: 'rebalance' }])
    expect(await applyRebalance(d, ['p'], 1, 2, 9)).toEqual({ ok: false, message: 'Nothing to move' })
  })
  it('pin and unpin toggle a flag and drop it when off', async () => {
    const d = await db()
    expect(await setPinned(d, 'a', true)).toEqual({ ok: true })
    expect((await d.tickets.get('a'))!.pinned).toBe(true)
    await setPinned(d, 'a', false)
    expect('pinned' in (await d.tickets.get('a'))!).toBe(false)
    expect(await setPinned(d, 'nope', true)).toEqual({ ok: false, message: 'Ticket not found' })
  })
})

describe('core minutes setting', () => {
  it('saves a valid budget and refuses the rest', async () => {
    const d = await db()
    expect((await getSettings(d)).coreMinutes).toBeUndefined()
    expect(await saveCoreMinutes(d, 120)).toEqual({ ok: true })
    expect((await getSettings(d)).coreMinutes).toBe(120)
    for (const bad of [0, 29, 20161, 90.5, NaN]) expect(await saveCoreMinutes(d, bad)).toEqual({ ok: false, message: CORE_MINUTES_ERROR })
    expect((await getSettings(d)).coreMinutes).toBe(120)
  })
})

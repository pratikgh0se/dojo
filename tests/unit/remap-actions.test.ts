import { describe, expect, it } from 'vitest'
import { remapTicketIds } from '../../src/data/remapActions'
import { runReconcile } from '../../src/data/seed'
import type { DojoDB } from '../../src/data/db'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'
import type { PictureRow } from '../../src/data/types'

const pic = (key: string, createdAt: number, source: PictureRow['source'] = 'library'): PictureRow => ({ key, json: {} as never, source, createdAt })

async function seedRefs(d: DojoDB, id: string) {
  await d.sessions.add({ id: 's1', ticketId: id, start: 1, end: 2, minutes: 1, outcome: 'solved', xpDelta: 0 })
  await d.redos.add({ id: 'r1', ticketId: id, source: 'gave_up', createdAt: 1, stage: 0, due: 5, passed: [], helpCost: 0, refunded: 0 })
  await d.rungUses.add({ id: 'ru1', ticketId: id, attemptStart: 1, cycleId: 'c', rung: 2, at: 1, cost: 1, applied: 1, refunded: 0 })
  await d.checkAttempts.add({ id: 'ca1', ticketId: id, at: 1, answers: [], feedback: [], passed: true })
  await d.code.put({ ticketId: id, lang: 'py', source: 'x', updatedAt: 1 })
  await d.grades.add({ id: 'g1', targetKind: 'ticket', targetId: id, at: 1, score: 1, max: 1, passed: true, feedback: [], missing: [], provider: 'fake' })
  await d.bankItems.add({ id: 'bank:x', bank: 'mine', key: 'x', name: 'x', pattern: null, status: 'done', ticketId: id, addedAt: 1 })
  await d.designSessions.add({ id: 'ds1', designId: id, at: 1, phase: 'done', minutes: 45, mode: 'solo', view: '2d', canvas: { nodes: [], links: [] } as never, close: {} as never, deepDives: [], tradeoffs: [], rubric: 1, lenses: {} })
  await d.aiLog.add({ job: 'hint', at: 1, ms: 1, provider: 'fake', ok: true, ticketId: id })
  await d.sessions.add({ id: 's2', ticketId: 'unrelated', start: 1, end: 2, minutes: 1, outcome: 'solved', xpDelta: 0, cards: ['other', id] })
  await d.events.add({ t: 'tick', id, at: 1, xp: 5 })
  await d.events.add({ t: 'slide_sprint', at: 2, sprint: 1, count: 1, to: 2, ids: [id, 'other'] } as never) // legacy event type
}
async function expectRefs(d: DojoDB, id: string) {
  expect((await d.sessions.get('s1'))!.ticketId).toBe(id)
  expect((await d.sessions.get('s2'))!.cards).toEqual(['other', id])
  expect((await d.sessions.get('s2'))!.ticketId).toBe('unrelated')
  expect((await d.redos.get('r1'))!.ticketId).toBe(id)
  expect((await d.rungUses.get('ru1'))!.ticketId).toBe(id)
  expect((await d.checkAttempts.get('ca1'))!.ticketId).toBe(id)
  expect((await d.code.toArray()).map(c => c.ticketId)).toEqual([id])
  expect((await d.grades.get('g1'))!.targetId).toBe(id)
  expect((await d.bankItems.get('bank:x'))!.ticketId).toBe(id)
  expect((await d.designSessions.get('ds1'))!.designId).toBe(id)
  expect((await d.aiLog.toArray())[0].ticketId).toBe(id)
  const ev = await d.events.toArray()
  expect(ev[0]).toMatchObject({ t: 'tick', id })
  expect((ev[1] as unknown as { ids: string[] }).ids).toEqual([id, 'other'])
}

describe('R1: a plan rename moves every reference', () => {
  it('runReconcile follows idMap through all tables, not just sessions and events', async () => {
    const d = freshDb()
    await d.tickets.add(mkTicket({ id: 'old1', status: 'done', xp: 5, doneAt: 1 }))
    await seedRefs(d, 'old1')
    await runReconcile(d, { ...flatPlanV2, idMap: { old1: 'm1w1t1' } })
    expect(await d.tickets.get('old1')).toBeUndefined()
    expect((await d.tickets.get('m1w1t1'))!).toMatchObject({ status: 'done', xp: 5 })
    await expectRefs(d, 'm1w1t1')
  })
})

describe('remapTicketIds', () => {
  it('moves a reference in every table and reports the rows changed', async () => {
    const d = freshDb()
    await seedRefs(d, 'a~1')
    const counts = await remapTicketIds(d, [{ from: 'a~1', to: 'a' }])
    await expectRefs(d, 'a')
    expect(counts).toMatchObject({ sessions: 2, redos: 1, rungUses: 1, checkAttempts: 1, code: 1, grades: 1, bankItems: 1, designSessions: 1, aiLog: 1, events: 2 })
  })
  it('does nothing for an empty or identity map', async () => {
    const d = freshDb()
    await seedRefs(d, 'a')
    expect(await remapTicketIds(d, [{ from: 'a', to: 'a' }])).toEqual({})
    await expectRefs(d, 'a')
  })
  it('merges the code rows when both ids had code: newest source first, the older one commented out (MIG-08)', async () => {
    const d = freshDb()
    await d.code.bulkPut([{ ticketId: 'a~1', lang: 'py', source: 'new', updatedAt: 9 }, { ticketId: 'a', lang: 'py', source: 'old', updatedAt: 2 }])
    await remapTicketIds(d, [{ from: 'a~1', to: 'a' }])
    expect(await d.code.toArray()).toEqual([{ ticketId: 'a', lang: 'py', source: 'new\n\n# earlier code kept by the R1 migration\n# old', updatedAt: 9 }])
  })
  it('moves a picture to a free destination key', async () => {
    const d = freshDb()
    await d.pictures.put(pic('a~1', 5))
    const counts = await remapTicketIds(d, [{ from: 'a~1', to: 'a' }])
    expect(await d.pictures.toArray()).toEqual([pic('a', 5)])
    expect(counts.pictures).toBe(1)
  })
  it('keeps an existing newer picture and drops the old one', async () => {
    const d = freshDb()
    await d.pictures.bulkPut([pic('a~1', 2, 'model'), pic('a', 9, 'library')])
    await remapTicketIds(d, [{ from: 'a~1', to: 'a' }])
    expect(await d.pictures.toArray()).toEqual([pic('a', 9, 'library')])
  })
  it('lets the old picture win over an older destination', async () => {
    const d = freshDb()
    await d.pictures.bulkPut([pic('a~1', 9, 'model'), pic('a', 2, 'library')])
    await remapTicketIds(d, [{ from: 'a~1', to: 'a' }])
    expect(await d.pictures.toArray()).toEqual([pic('a', 9, 'model')])
  })
  it('rewrites a ticket\'s origin, childOf and children and leaves its other fields alone', async () => {
    const d = freshDb()
    const child = { ...mkTicket({ id: 'kid', origin: 'a~1', xp: 7, status: 'done', doneAt: 3 }), childOf: 'a~1' } as never
    const parent = { ...mkTicket({ id: 'p' }), children: ['a~1', 'k2'] } as never
    await d.tickets.bulkPut([child, parent])
    await remapTicketIds(d, [{ from: 'a~1', to: 'a' }])
    expect(await d.tickets.get('kid')).toEqual({ ...(child as object), origin: 'a', childOf: 'a' })
    expect(await d.tickets.get('p')).toEqual({ ...(parent as object), children: ['a', 'k2'] })
  })
  it('leaves a non-ticket grade with the same targetId alone', async () => {
    const d = freshDb()
    await d.grades.add({ id: 'g9', targetKind: 'artifact', targetId: 'a~1', at: 1, score: 1, max: 1, passed: true, feedback: [], missing: [], provider: 'fake' })
    const counts = await remapTicketIds(d, [{ from: 'a~1', to: 'a' }])
    expect((await d.grades.get('g9'))!.targetId).toBe('a~1')
    expect(counts.grades).toBeUndefined()
  })
  it('merges two sources into one target in one call', async () => {
    const d = freshDb()
    await d.sessions.bulkAdd([
      { id: 's1', ticketId: 'a~1', start: 1, end: 2, minutes: 1, outcome: 'solved', xpDelta: 0 },
      { id: 's2', ticketId: 'a~2', start: 1, end: 2, minutes: 1, outcome: 'solved', xpDelta: 0 },
    ])
    await d.redos.bulkAdd([
      { id: 'r1', ticketId: 'a~1', source: 'gave_up', createdAt: 1, stage: 0, due: 5, passed: [], helpCost: 0, refunded: 0 },
      { id: 'r2', ticketId: 'a~2', source: 'gave_up', createdAt: 1, stage: 0, due: 5, passed: [], helpCost: 0, refunded: 0 },
    ])
    await d.code.bulkPut([
      { ticketId: 'a~1', lang: 'py', source: 'one', updatedAt: 4 },
      { ticketId: 'a~2', lang: 'py', source: 'two', updatedAt: 8 },
      { ticketId: 'a~1', lang: 'go', source: 'go1', updatedAt: 1 },
    ])
    await remapTicketIds(d, [{ from: 'a~1', to: 'a' }, { from: 'a~2', to: 'a' }])
    expect((await d.sessions.toArray()).map(s => s.ticketId)).toEqual(['a', 'a'])
    expect((await d.redos.toArray()).map(r => r.ticketId)).toEqual(['a', 'a'])
    const code = (await d.code.toArray()).sort((x, y) => x.lang.localeCompare(y.lang))
    expect(code).toEqual([
      { ticketId: 'a', lang: 'go', source: 'go1', updatedAt: 1 },
      { ticketId: 'a', lang: 'py', source: 'two\n\n# earlier code kept by the R1 migration\n# one', updatedAt: 8 },
    ])
  })
  it('on an equal code timestamp the lower original ticket id comes first, as in the pure remapRows (the container before its parts)', async () => {
    const d = freshDb()
    await d.code.bulkPut([{ ticketId: 'a~1', lang: 'py', source: 'moved', updatedAt: 5 }, { ticketId: 'a', lang: 'py', source: 'existing', updatedAt: 5 }])
    await remapTicketIds(d, [{ from: 'a~1', to: 'a' }])
    expect(await d.code.toArray()).toEqual([{ ticketId: 'a', lang: 'py', source: 'existing\n\n# earlier code kept by the R1 migration\n# moved', updatedAt: 5 }])
  })
  it('writes one merged row and deletes every losing row, and keeps lastLang from any of them', async () => {
    const d = freshDb()
    await d.code.bulkPut([
      { ticketId: 'a~1', lang: 'py', source: 'one', updatedAt: 4, lastLang: true },
      { ticketId: 'a~2', lang: 'py', source: 'two', updatedAt: 8 },
      { ticketId: 'a', lang: 'py', source: 'base', updatedAt: 1 },
      { ticketId: 'z', lang: 'py', source: 'other', updatedAt: 1 },
    ])
    const counts = await remapTicketIds(d, [{ from: 'a~1', to: 'a' }, { from: 'a~2', to: 'a' }])
    expect(counts.code).toBe(2)
    const rows = (await d.code.toArray()).sort((x, y) => x.ticketId.localeCompare(y.ticketId))
    expect(rows.map(r => r.ticketId)).toEqual(['a', 'z'])
    expect(rows[0]).toEqual({
      ticketId: 'a', lang: 'py', updatedAt: 8, lastLang: true,
      source: 'two\n\n# earlier code kept by the R1 migration\n# one\n\n# earlier code kept by the R1 migration\n# base',
    })
  })
  it('gives the same row whichever order the pairs come in (the pure rule)', async () => {
    const rows = [
      { ticketId: 'a~1', lang: 'py' as const, source: 'one', updatedAt: 5 },
      { ticketId: 'a~2', lang: 'py' as const, source: 'two', updatedAt: 5 },
      { ticketId: 'a', lang: 'py' as const, source: 'base', updatedAt: 5 },
    ]
    const run = async (pairs: { from: string; to: string }[]) => {
      const d = freshDb()
      await d.code.bulkPut(rows)
      await remapTicketIds(d, pairs)
      return d.code.toArray()
    }
    const p1 = { from: 'a~1', to: 'a' }, p2 = { from: 'a~2', to: 'a' }
    expect(await run([p1, p2])).toEqual(await run([p2, p1]))
  })
  it('rejects chained or cyclic pairs instead of half-applying them', async () => {
    const d = freshDb()
    await seedRefs(d, 'a')
    await expect(remapTicketIds(d, [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }])).rejects.toThrow(/chain/i)
    await expect(remapTicketIds(d, [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).rejects.toThrow(/chain/i)
    await expectRefs(d, 'a')
  })
})

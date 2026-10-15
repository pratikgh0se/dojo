import { describe, expect, it } from 'vitest'
import { clearOrderOverride, reorderInLane } from '../../src/data/queueActions'
import { moveTicket } from '../../src/data/boardActions'
import { effectiveOrder } from '../../src/rules/dayMix'
import { freshDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'

const seed = async () => {
  const d = freshDb()
  await d.tickets.bulkAdd(['a', 'b', 'c', 'd', 'e'].map((id, i) => mkTicket({ id, lane: 'dsa', order: i + 1, track: 'interview', kind: 'problem' })))
  await d.tickets.add(mkTicket({ id: 'p1', lane: 'path', order: 0.5 }))
  return d
}

describe('reorderInLane', () => {
  it('writes one orderOverride between the new neighbours and leaves order and other tickets alone (PATH-20)', async () => {
    const d = await seed()
    expect(await reorderInLane(d, 'e', 1)).toEqual({ ok: true, patched: 1 })
    const all = await d.tickets.toArray()
    const e = all.find(t => t.id === 'e')!
    expect(e.order).toBe(5)
    expect(e.orderOverride).toBeGreaterThan(1)
    expect(e.orderOverride).toBeLessThan(2)
    expect(all.filter(t => t.id !== 'e').every(t => t.orderOverride === undefined)).toBe(true)
    expect(all.filter(t => t.lane === 'dsa').sort((x, y) => effectiveOrder(x) - effectiveOrder(y)).map(t => t.id)).toEqual(['a', 'e', 'b', 'c', 'd'])
  })
  it('refuses a missing, archived or finished ticket and changes nothing', async () => {
    const d = await seed()
    await d.tickets.update('a', { status: 'done' })
    await d.tickets.update('b', { archived: true })
    for (const id of ['a', 'b', 'nope']) expect(await reorderInLane(d, id, 0)).toMatchObject({ ok: false })
    expect((await d.tickets.toArray()).every(t => t.orderOverride === undefined)).toBe(true)
  })
  it('clearOrderOverride puts the ticket back at its plan order', async () => {
    const d = await seed()
    await reorderInLane(d, 'e', 0)
    await clearOrderOverride(d, 'e')
    expect('orderOverride' in (await d.tickets.get('e'))!).toBe(false)
  })
})

describe('Doing is a soft cap', () => {
  it('a fourth started ticket is allowed (PATH-18); the warning is a selector, not a refusal', async () => {
    const d = await seed()
    for (const id of ['a', 'b', 'c', 'd']) expect(await moveTicket(d, id, 'doing', 1000)).toEqual({ ok: true, xpDelta: 0 })
    expect((await d.tickets.filter(t => t.status === 'doing').count())).toBe(4)
  })
})

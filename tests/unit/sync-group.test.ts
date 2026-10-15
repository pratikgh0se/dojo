import { beforeEach, describe, expect, it } from 'vitest'
import { createDb, type DojoDB, type OutboxRow } from '../../src/data/db'
import { createSyncLoop } from '../../src/data/sync/loop'
import { getRejectedCount } from '../../src/data/sync/status'
import type { SyncGate } from '../../src/data/sync/middleware'
import { mkTicket } from '../helpers/tickets'

let d: DojoDB
let gate: SyncGate
let n = 0
beforeEach(() => { gate = { bypass: false }; d = createDb(`sync-group-${n++}`, gate) })

const row = (i: number, grp?: string): OutboxRow => ({ opId: `op-${i}`, tbl: 'tickets', op: 'put', id: `t${i}`, doc: { id: `t${i}` }, at: 'x', ...(grp ? { grp } : {}) })

describe('outbox groups', () => {
  it('writes made while gate.group is set carry it; others carry none', async () => {
    await d.tickets.put(mkTicket({ id: 'a' }))
    gate.group = 'g1'
    await d.tickets.put(mkTicket({ id: 'b' }))
    gate.group = undefined
    const rows = await d._outbox.orderBy('seq').toArray()
    expect(rows.map(r => r.grp)).toEqual([undefined, 'g1'])
  })

  it('the loop sends one group in a single request even above the batch size, then the rest', async () => {
    await d._outbox.bulkAdd([...Array.from({ length: 700 }, (_, i) => row(i, 'g1')), row(900), row(901)])
    const sizes: number[] = []
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      sizes.push(JSON.parse(String(init?.body)).ops.length)
      return new Response(JSON.stringify({ ok: true }))
    }) as typeof fetch
    const l = createSyncLoop({ db: d, clientId: 'c1', fetchImpl, debounceMs: 5, backoffMs: [10], pollMs: 60_000, setState: () => {}, adoptedDb: 'db1' })
    expect(await l.flush()).toBe(true)
    expect(sizes).toEqual([700, 2])
    expect(await d._outbox.count()).toBe(0)
  })

  it('a group is not merged with a different group or with rows after it, and grp never reaches the server', async () => {
    await d._outbox.bulkAdd([row(1, 'g1'), row(2, 'g1'), row(3, 'g2'), row(4, 'g1')])
    const bodies: Array<{ ops: Array<Record<string, unknown>> }> = []
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ ok: true }))
    }) as typeof fetch
    const l = createSyncLoop({ db: d, clientId: 'c1', fetchImpl, debounceMs: 5, backoffMs: [10], pollMs: 60_000, setState: () => {}, adoptedDb: 'db1' })
    expect(await l.flush()).toBe(true)
    expect(bodies.map(b => b.ops.length)).toEqual([2, 1, 1])
    expect(bodies.flatMap(b => b.ops).every(o => !('grp' in o))).toBe(true)
  })

  it('a 413 on a group falls back to one row per request (best effort)', async () => {
    await d._outbox.bulkAdd([row(1, 'g1'), row(2, 'g1'), row(3, 'g1')])
    const sizes: number[] = []
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      const len = JSON.parse(String(init?.body)).ops.length
      sizes.push(len)
      return len > 1
        ? new Response(JSON.stringify({ error: { code: 'too_large', message: 'body too large' } }), { status: 413 })
        : new Response(JSON.stringify({ ok: true }))
    }) as typeof fetch
    const l = createSyncLoop({ db: d, clientId: 'c1', fetchImpl, debounceMs: 5, backoffMs: [10], pollMs: 60_000, setState: () => {}, adoptedDb: 'db1' })
    expect(await l.flush()).toBe(true)
    expect(sizes).toEqual([3, 1, 1, 1])
    expect(await d._outbox.count()).toBe(0)
  })

  it('ungrouped rows before a group stop where it starts, so the batch window never splits a group', async () => {
    await d._outbox.bulkAdd([...Array.from({ length: 498 }, (_, i) => row(i)), ...Array.from({ length: 5 }, (_, i) => row(1000 + i, 'g1'))])
    const sizes: number[] = []
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      sizes.push(JSON.parse(String(init?.body)).ops.length)
      return new Response(JSON.stringify({ ok: true }))
    }) as typeof fetch
    const l = createSyncLoop({ db: d, clientId: 'c1', fetchImpl, debounceMs: 5, backoffMs: [10], pollMs: 60_000, setState: () => {}, adoptedDb: 'db1' })
    expect(await l.flush()).toBe(true)
    expect(sizes).toEqual([498, 5])
  })

  it('the page-hide fast path never sends part of a group', async () => {
    const hidden: string[][] = []
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      if (init?.keepalive) hidden.push(JSON.parse(String(init.body)).ops.map((o: { opId: string }) => o.opId))
      return new Response(JSON.stringify({ ok: true }))
    }) as typeof fetch
    const l = createSyncLoop({ db: d, clientId: 'c1', fetchImpl, debounceMs: 5, backoffMs: [10], pollMs: 60_000, setState: () => {}, adoptedDb: 'db1' })
    await l.flush() // memory mirrors the empty outbox
    l.queued([row(1), row(2, 'g1'), row(3, 'g1')])
    l.flushOnHide()
    expect(hidden).toEqual([['op-1']])
    l.stop()
  })

  describe('a group the server refuses is held whole', () => {
    const mk = (fetchImpl: typeof fetch) => createSyncLoop({ db: d, clientId: 'c1', fetchImpl, debounceMs: 5, backoffMs: [10], pollMs: 60_000, setState: () => {}, adoptedDb: 'db1' })
    const refuse = (status: number, code: string) => new Response(JSON.stringify({ error: { code, message: 'nope' } }), { status })

    it.each([[400, 'bad_request'], [422, 'unprocessable'], [409, 'conflict']])('a %i on a group parks all its rows together, sends no second request for it, and ungrouped rows behind it still go out', async (status, code) => {
      await d._outbox.bulkAdd([row(1), row(2, 'g1'), row(3, 'g1'), row(4, 'g1'), row(5), row(6)])
      const sent: string[][] = []
      const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
        const ids = (JSON.parse(String(init?.body)).ops as Array<{ opId: string }>).map(o => o.opId)
        sent.push(ids)
        return ids.includes('op-2') ? refuse(status, code) : new Response(JSON.stringify({ ok: true }))
      }) as typeof fetch
      const l = mk(fetchImpl)
      expect(await l.flush()).toBe(true)
      expect(sent).toEqual([['op-1'], ['op-2', 'op-3', 'op-4'], ['op-5', 'op-6']])
      expect(await d._outbox.count()).toBe(0)
      const parked = await l.listRejected()
      expect(parked.map(p => p.opId)).toEqual(['op-2', 'op-3', 'op-4'])
      expect(parked.every(p => p.grp === 'g1' && typeof p.error === 'string' && p.error.startsWith(`HTTP ${status}`))).toBe(true)
      expect(getRejectedCount()).toBe(3)
    })

    it('retryRejected puts the group back contiguously with grp, and the next send is one request', async () => {
      gate.group = 'g1'
      for (const i of [1, 2, 3]) await d.tickets.put(mkTicket({ id: `t${i}` }))
      gate.group = undefined
      const ids = (await d._outbox.orderBy('seq').toArray()).map(r => r.opId)
      let refusing = true
      const sent: string[][] = []
      const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
        sent.push((JSON.parse(String(init?.body)).ops as Array<{ opId: string }>).map(o => o.opId))
        return refusing ? refuse(422, 'unprocessable') : new Response(JSON.stringify({ ok: true }))
      }) as typeof fetch
      const l = mk(fetchImpl)
      expect(await l.flush()).toBe(true)
      expect(sent).toEqual([ids])
      expect(await l.listRejected()).toHaveLength(3)
      await d.tickets.put(mkTicket({ id: 'later' })) // a newer ungrouped write queued while the group is parked
      refusing = false
      sent.length = 0
      expect(await l.retryRejected()).toBe(true)
      expect(sent[0]).toEqual(ids)
      expect(sent).toHaveLength(2)
      expect(sent[1]).toHaveLength(1)
      expect(await d._outbox.count()).toBe(0)
      expect(await l.listRejected()).toEqual([])
      expect(getRejectedCount()).toBe(0)
    })

    it('after a retry the group is again all-or-nothing: refused again, it is parked whole again', async () => {
      gate.group = 'g1'
      for (const i of [1, 2]) await d.tickets.put(mkTicket({ id: `t${i}` }))
      gate.group = undefined
      const sent: string[][] = []
      const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
        sent.push((JSON.parse(String(init?.body)).ops as Array<{ opId: string }>).map(o => o.opId))
        return refuse(400, 'bad_request')
      }) as typeof fetch
      const l = mk(fetchImpl)
      await l.flush()
      await l.retryRejected()
      expect(sent.map(s => s.length)).toEqual([2, 2])
      const parked = await l.listRejected()
      expect(parked.map(p => p.grp)).toEqual(['g1', 'g1'])
    })
  })
})

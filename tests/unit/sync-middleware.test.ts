import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb, type DojoDB } from '../../src/data/db'
import { installOutbox, type SyncGate } from '../../src/data/sync/middleware'
import { mkTicket } from '../helpers/tickets'
import { realPlan } from '../helpers/plan'
import { runReconcile } from '../../src/data/seed'
import { ensureSeedArtifacts } from '../../src/data/projectActions'

let d: DojoDB
let gate: SyncGate
let n = 0
const outbox = () => d._outbox.orderBy('seq').toArray()

beforeEach(async () => {
  d = createDb(`sync-mw-${n++}`)
  gate = { bypass: false }
  installOutbox(d, gate)
  await d.open()
})

describe('outbox middleware', () => {
  it('records put ops for add/put/bulkPut with the stored doc', async () => {
    const t = mkTicket({ id: 'a' })
    await d.tickets.add(t)
    await d.tickets.put({ ...t, status: 'done' })
    await d.tickets.bulkPut([{ ...t, id: 'b' }, { ...t, id: 'c' }])
    const rows = await outbox()
    expect(rows.map(r => [r.tbl, r.op, r.id])).toEqual([['tickets', 'put', 'a'], ['tickets', 'put', 'a'], ['tickets', 'put', 'b'], ['tickets', 'put', 'c']])
    expect((rows[1].doc as { status: string }).status).toBe('done')
    expect(new Set(rows.map(r => r.opId)).size).toBe(4)
  })

  it('append-only ++seq rows get the disk id `${clientId}:${seq}` (I3), from _meta when boot has not set it', async () => {
    const k = await d.events.add({ t: 'x' } as never)
    const [r] = await outbox()
    const cid = (await d._meta.get('clientId'))?.value
    expect(typeof cid).toBe('string')
    expect(r.id).toBe(`${cid}:${k}`)
    expect(r.doc).toEqual({ t: 'x', _diskId: `${cid}:${k}` })
  })

  it('delete, bulkDelete, partial-range delete and clear', async () => {
    await d.tickets.bulkPut(['a', 'b', 'c', 'd'].map(id => mkTicket({ id })))
    await d._outbox.clear()
    await d.tickets.delete('a')
    await d.tickets.bulkDelete(['b'])
    await d.tickets.where('id').equals('c').delete()
    expect((await outbox()).map(r => [r.op, r.id])).toEqual([['delete', 'a'], ['delete', 'b'], ['delete', 'c']])
    await d._outbox.clear()
    await d.tickets.clear()
    expect((await outbox()).map(r => [r.op, r.tbl, r.id])).toEqual([['clear', 'tickets', undefined]])
  })

  it('modify() produces put ops with the changed doc', async () => {
    await d.tickets.put(mkTicket({ id: 'a' }))
    await d._outbox.clear()
    await d.tickets.where('id').equals('a').modify({ status: 'done' })
    const rows = await outbox()
    expect(rows).toHaveLength(1)
    expect((rows[0].doc as { status: string }).status).toBe('done')
  })

  it('an aborted transaction leaves neither the write nor the outbox entry', async () => {
    await expect(d.transaction('rw', d.tickets, async () => {
      await d.tickets.put(mkTicket({ id: 'z' }))
      throw new Error('abort')
    })).rejects.toThrow('abort')
    expect(await d.tickets.count()).toBe(0)
    expect(await d._outbox.count()).toBe(0)
  })

  it('an explicit transaction commits the write and outbox entry together', async () => {
    await d.transaction('rw', d.tickets, d.settings, async () => {
      await d.tickets.put(mkTicket({ id: 'z' }))
      await d.settings.put({ id: 'main' } as never)
    })
    expect((await outbox()).map(r => r.tbl)).toEqual(['tickets', 'settings'])
  })

  it('never observes _outbox/_meta and honours the bypass gate', async () => {
    await d._meta.put({ key: 'k', value: 1 })
    expect(await d._outbox.count()).toBe(0)
    gate.bypass = true
    await d.tickets.put(mkTicket({ id: 'q' }))
    gate.bypass = false
    expect(await d._outbox.count()).toBe(0)
  })

  it('notifies onQueued', async () => {
    const seen: string[][] = []
    gate.onQueued = rows => { seen.push(rows.map(r => r.id ?? '')) }
    await d.tickets.put(mkTicket({ id: 'q' }))
    await vi.waitFor(() => expect(seen).toEqual([['q']]))
    // an aborted transaction never notifies
    await d.transaction('rw', d.tickets, async () => { await d.tickets.put(mkTicket({ id: 'r' })); throw new Error('x') }).catch(() => {})
    await new Promise(r => setTimeout(r, 20))
    expect(seen).toEqual([['q']])
  })
})

describe('I6: no-op puts record nothing', () => {
  it('re-putting an identical row, or a modify that changes nothing, queues no op', async () => {
    const t = mkTicket({ id: 'a', proof: { note: 'x' } })
    await d.tickets.put(t)
    await d.tickets.put({ ...t, proof: { note: 'x' } }) // equal, but a different object
    await d.tickets.where('id').equals('a').modify({ status: t.status })
    expect(await d._outbox.count()).toBe(1)
    await d.tickets.put({ ...t, status: 'done' })
    expect(await d._outbox.count()).toBe(2)
  })

  it('a bulkPut records only the rows that changed', async () => {
    await d.tickets.bulkPut([mkTicket({ id: 'a' }), mkTicket({ id: 'b' })])
    await d._outbox.clear()
    await d.tickets.bulkPut([mkTicket({ id: 'a' }), mkTicket({ id: 'b', status: 'done' })])
    expect((await outbox()).map(r => r.id)).toEqual(['b'])
  })

  it('two boots add 0 ops the second time (reconcile + seed artifacts)', async () => {
    const plan = realPlan()
    await runReconcile(d, plan)
    await ensureSeedArtifacts(d, 1)
    const first = await d._outbox.count()
    expect(first).toBeGreaterThan(0)
    await runReconcile(d, plan)
    await ensureSeedArtifacts(d, 2)
    expect(await d._outbox.count()).toBe(first)
  })
})

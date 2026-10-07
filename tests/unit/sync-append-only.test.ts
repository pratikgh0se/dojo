import { beforeEach, describe, expect, it } from 'vitest'
import { openSqlite, runMigrations } from '../../server/db/adapter.mjs'
import { createStore, DbError, type Store } from '../../server/db/store.mjs'
import { createDb, type DojoDB, type OutboxRow } from '../../src/data/db'
import { hydrate } from '../../src/data/sync/hydrate'
import { createSyncLoop, type SyncLoop } from '../../src/data/sync/loop'
import { installOutbox, type SyncGate } from '../../src/data/sync/middleware'
import { mkTicket } from '../helpers/tickets'

// I3: events / aiLog / atlasRuns use ++seq, so every browser numbers its rows 1, 2, 3...
// Their disk id is `${clientId}:${seq}`; hydrated rows get fresh local seqs and keep `_diskId`.
let store: Store
let n = 0
const server = (st: Store): typeof fetch => async (input, init) => {
  const path = new URL(String(input), 'http://x').pathname
  const body = init?.body ? JSON.parse(String(init.body)) : null
  const reply = (status: number, b: unknown) => new Response(JSON.stringify(b), { status })
  try {
    if (path === '/db/health') return reply(200, st.health())
    if (path === '/db/state') return reply(200, st.state())
    if (path === '/db/ops') return reply(200, st.applyOps(body))
  } catch (e) {
    if (e instanceof DbError) return reply(e.status, { ok: false, error: { code: e.code, message: e.message } })
    throw e
  }
  return reply(404, {})
}

interface Client { d: DojoDB; gate: SyncGate; loop: SyncLoop; id: string }
async function client(id: string): Promise<Client> {
  const d = createDb(`append-only-${n++}`)
  const gate: SyncGate = { bypass: false, clientId: id }
  installOutbox(d, gate)
  await d.open()
  await d._meta.put({ key: 'clientId', value: id })
  const loop = createSyncLoop({ db: d, clientId: id, fetchImpl: server(store), debounceMs: 1, backoffMs: [10], pollMs: 60_000, setState: () => {}, adoptedDb: store.health().dbId })
  return { d, gate, loop, id }
}
const outbox = (d: DojoDB) => d._outbox.orderBy('seq').toArray()

beforeEach(() => {
  const a = openSqlite(':memory:')
  runMigrations(a)
  store = createStore(() => a)
})

describe('I3: append-only disk ids', () => {
  it('an event is sent as `${clientId}:${seq}` with _diskId in the doc and no local seq, as a create', async () => {
    const c = await client('cA')
    const k = await c.d.events.add({ t: 'tick', id: 'p1', at: 1, xp: 10 })
    const [r] = await outbox(c.d)
    expect(r.id).toBe(`cA:${k}`)
    expect(r.create).toBe(true)
    expect(r.doc).toEqual({ t: 'tick', id: 'p1', at: 1, xp: 10, _diskId: `cA:${k}` })
  })

  it('an undo carries the disk id of the event it undoes', async () => {
    const c = await client('cA')
    const k = await c.d.events.add({ t: 'tick', id: 'p1', at: 1, xp: 10 })
    await c.d.events.add({ t: 'undo', at: 2, of: k })
    const rows = await outbox(c.d)
    expect((rows[1].doc as { _ofDiskId?: string })._ofDiskId).toBe(`cA:${k}`)
  })

  it('two clients writing seq 101 keep two docs; a third client hydrates both with fresh seqs and a remapped undo', async () => {
    const a = await client('cA')
    const b = await client('cB')
    for (const c of [a, b]) {
      await c.d.events.add({ seq: 101, t: 'tick', id: `p-${c.id}`, at: c.id === 'cA' ? 10 : 20, xp: 10 } as never)
      await c.d.events.add({ seq: 102, t: 'undo', at: c.id === 'cA' ? 11 : 21, of: 101 } as never)
      expect(await c.loop.flush()).toBe(true)
    }
    const disk = store.state().tables.events as { _diskId: string }[]
    expect(disk.map(e => e._diskId).sort()).toEqual(['cA:101', 'cA:102', 'cB:101', 'cB:102'])

    // a third browser starts empty and restores from the server
    const c = await client('cC')
    await c.d._meta.put({ key: 'syncedDb', value: (store.health() as { dbId?: string }).dbId ?? null })
    expect(await hydrate({ db: c.d, gate: c.gate, loop: c.loop, clientId: 'cC', fetchImpl: server(store) })).toBe('restored')
    const local = await c.d.events.orderBy('seq').toArray() as unknown as { seq: number; t: string; id?: string; of?: number; _diskId: string }[]
    expect(local.map(e => e._diskId)).toEqual(['cA:101', 'cA:102', 'cB:101', 'cB:102']) // chronological
    expect(new Set(local.map(e => e.seq)).size).toBe(4)
    const byDisk = Object.fromEntries(local.map(e => [e._diskId, e]))
    expect(byDisk['cA:102'].of).toBe(byDisk['cA:101'].seq)
    expect(byDisk['cB:102'].of).toBe(byDisk['cB:101'].seq)

    // editing a hydrated row maps back to its disk doc: no duplicate appears, and it is a declared edit
    await c.d.events.update(byDisk['cB:101'].seq, { id: 'renamed' } as never)
    const [edit] = await outbox(c.d)
    expect(edit).toMatchObject<Partial<OutboxRow>>({ id: 'cB:101', known: true }) // an edit of a hydrated row (Addendum 2)
    expect(edit.create).toBeUndefined() // not a new row
    expect(await c.loop.flush()).toBe(true)
    const after = store.state().tables.events as { _diskId: string; id?: string }[]
    expect(after).toHaveLength(4)
    expect(after.find(e => e._diskId === 'cB:101')?.id).toBe('renamed')
    for (const x of [a, b, c]) x.loop.stop()
  })

})

describe('an added row never inherits another row\'s disk id', () => {
  it('add() of a copy that carries _diskId stores and sends it under its own new id', async () => {
    const c = await client('cA')
    const k = await c.d.events.add({ t: 'tick', id: 'p1', at: 1, xp: 10, _diskId: 'cB:7' } as never)
    const row = await c.d.events.get(k) as unknown as Record<string, unknown>
    expect(row._diskId).toBeUndefined()
    const [r] = await c.d._outbox.toArray()
    expect(r.id).toBe(`cA:${k}`)
    expect(r.create).toBe(true)
    c.loop.stop()
  })
})

describe('a browser restored from an old copy (Time Machine) gets a new clientId', () => {
  async function setup(generatorAt: number) {
    store.applyOps({ clientId: 'cT', ops: [
      { tbl: 'events', op: 'put', id: 'cT:1', doc: { t: 'tick', id: 'p1', at: 1, xp: 1, _diskId: 'cT:1' }, at: 'x' },
      { tbl: 'events', op: 'put', id: 'cT:40', doc: { t: 'tick', id: 'p2', at: 2, xp: 1, _diskId: 'cT:40' }, at: 'x' },
    ] })
    const c = await client('cT')
    await c.d._meta.put({ key: 'syncedDb', value: store.health().dbId })
    c.gate.bypass = true // the old copy's key generator stopped at `generatorAt`
    for (let i = 1; i < generatorAt; i++) await c.d.events.add({ t: 'x', at: 0 } as never)
    await c.d.events.clear()
    c.gate.bypass = false
    expect(await hydrate({ db: c.d, gate: c.gate, loop: c.loop, clientId: 'cT', fetchImpl: server(store) })).toBe('restored')
    return c
  }

  it('its key generator is behind the seqs it already wrote to disk: new id, no collision', async () => {
    const c = await setup(10)
    const id = (await c.d._meta.get('clientId'))?.value as string
    expect(id).not.toBe('cT')
    expect(c.gate.clientId).toBe(id)
    const k = await c.d.events.add({ t: 'tick', id: 'p3', at: 3, xp: 1 } as never)
    expect((await c.d._outbox.toArray()).at(-1)?.id).toBe(`${id}:${k}`)
    c.loop.stop()
  })

  it('an up-to-date browser keeps its id', async () => {
    const c = await setup(60)
    expect((await c.d._meta.get('clientId'))?.value).toBe('cT')
    c.loop.stop()
  })
})

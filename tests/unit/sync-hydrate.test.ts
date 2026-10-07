import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openSqlite, runMigrations } from '../../server/db/adapter.mjs'
import { createStore, DbError, type Store } from '../../server/db/store.mjs'
import { createDb, type DojoDB } from '../../src/data/db'
import { getClientId, hydrate } from '../../src/data/sync/hydrate'
import { createSyncLoop, type SyncLoop } from '../../src/data/sync/loop'
import { installOutbox, type SyncGate } from '../../src/data/sync/middleware'
import { getSaveState } from '../../src/data/sync/status'
import { mkTicket } from '../helpers/tickets'

let d: DojoDB
let gate: SyncGate
let loop: SyncLoop
let store: Store
let up: boolean
let n = 0
let killPrev: (() => void) | null = null

/** A fetch that talks to a real in-memory Store, like dojo-server would. */
let fakeServer: typeof fetch
const makeServer = (st: Store, isUp: () => boolean): typeof fetch => async (input, init) => {
  const store = st
  const path = new URL(String(input), 'http://x').pathname
  if (!isUp()) throw new TypeError('fetch failed')
  const body = init?.body ? JSON.parse(String(init.body)) : null
  const reply = (status: number, b: unknown) => new Response(JSON.stringify(b), { status })
  try {
    if (path === '/db/health') return reply(200, store.health())
    if (path === '/db/state') return reply(200, store.state())
    if (path === '/db/ops') return reply(200, store.applyOps(body))
  } catch (e) {
    if (e instanceof DbError) return reply(e.status, { ok: false })
    throw e
  }
  return reply(404, {})
}

const run = async () => hydrate({ db: d, gate, loop, clientId: await getClientId(d), fetchImpl: fakeServer })
/** This browser already adopted the server's database (C2). */
const adopted = () => d._meta.put({ key: 'syncedDb', value: store.health().dbId })

beforeEach(async () => {
  const a = openSqlite(':memory:')
  runMigrations(a)
  store = createStore(() => a)
  up = true
  const mine = store
  let alive = true
  fakeServer = makeServer(mine, () => up && alive)
  killPrev?.()
  killPrev = () => { alive = false }
  d = createDb(`hydrate-${n++}`)
  gate = { bypass: false, clientId: 'c' }
  installOutbox(d, gate)
  await d.open()
  await d._meta.put({ key: 'clientId', value: 'c' }) // one browser: the loop and the middleware agree
  loop = createSyncLoop({ db: d, clientId: 'c', fetchImpl: fakeServer, debounceMs: 1, backoffMs: [10], pollMs: 60_000 })
  gate.onQueued = rows => loop.queued(rows)
})

afterEach(() => { loop.stop() })

describe('hydrate', () => {
  it('unreachable server: Dexie alone, status offline, data untouched', async () => {
    await d.tickets.put(mkTicket({ id: 'a' }))
    up = false
    expect(await run()).toBe('unreachable')
    expect(getSaveState()).toBe('offline')
    expect(await d.tickets.count()).toBe(1)
  })

  it('both empty: fresh start', async () => {
    expect(await run()).toBe('fresh')
    expect(getSaveState()).toBe('saved')
  })

  it('empty server + a never-synced browser: the fresh start sends what it recorded, then no echo', async () => {
    loop.stop() // hydrate runs before any app write, so no debounced flush may race it
    await d.tickets.bulkPut([mkTicket({ id: 'a', status: 'done' }), mkTicket({ id: 'b' })])
    await d.settings.put({ id: 'main', startDate: '2026-10-05' } as never)
    await d.events.add({ t: 'tick' } as never)
    expect(await run()).toBe('fresh')
    expect(await d._outbox.count()).toBe(0)
    const tables = store.state().tables as Record<string, { id: string; status?: string }[]>
    expect(tables.tickets.find(t => t.id === 'a')?.status).toBe('done')
    expect(tables.settings).toHaveLength(1)
    expect(tables.events).toHaveLength(1)
    expect(store.health().ops).toBe(4)
  })

  it('server has docs: flushes the outbox first, then replaces Dexie without echoing', async () => {
    store.applyOps({ clientId: 'other', ops: [{ tbl: 'tickets', op: 'put', id: 'srv', doc: mkTicket({ id: 'srv' }), at: 'x' }] })
    loop.stop()
    await adopted()
    await d.tickets.put(mkTicket({ id: 'local-unsent' })) // sits in the outbox
    expect(await d._outbox.count()).toBeGreaterThan(0)
    const opsBefore = store.health().ops
    expect(await run()).toBe('restored')
    // the unsent local write reached the server, and the server's docs are now in Dexie
    expect((await d.tickets.toArray()).map(t => t.id).sort()).toEqual(['local-unsent', 'srv'])
    expect(store.health().ops).toBe(opsBefore + 1)
    expect(await d._outbox.count()).toBe(0) // the hydrate writes were not queued
  })

  it('server has docs: local rows the server does not know are dropped (server is the truth)', async () => {
    store.applyOps({ clientId: 'x', ops: [{ tbl: 'tickets', op: 'put', id: 'srv', doc: mkTicket({ id: 'srv' }), at: 'x' }] })
    await adopted()
    await d.sessions.put({ id: 's1', ticketId: 'a', start: 1 } as never)
    await d._outbox.clear() // pretend it was sent (older, already-deleted state)
    expect(await run()).toBe('restored')
    expect(await d.sessions.count()).toBe(0)
    expect(await d.tickets.count()).toBe(1)
  })

  it('server down while flushing before restore keeps local data and reports offline', async () => {
    store.applyOps({ clientId: 'x', ops: [{ tbl: 'tickets', op: 'put', id: 'srv', doc: mkTicket({ id: 'srv' }), at: 'x' }] })
    loop.stop()
    await adopted()
    await d.tickets.put(mkTicket({ id: 'mine' }))
    const failing: typeof fetch = async (i, n) => {
      if (String(i).endsWith('/db/ops')) throw new TypeError('down')
      return fakeServer(i, n)
    }
    const r = await hydrate({ db: d, gate, loop: createSyncLoop({ db: d, clientId: 'c', fetchImpl: failing, backoffMs: [10_000], pollMs: 60_000, adoptedDb: store.health().dbId }), clientId: 'c', fetchImpl: failing })
    expect(r).toBe('unreachable')
    expect((await d.tickets.toArray()).map(t => t.id)).toEqual(['mine'])
  })

  it('only tombstones on disk still counts as data: the disk wins, nothing is sent (Addendum 3)', async () => {
    store.applyOps({ clientId: 'x', ops: [{ tbl: 'a', op: 'put', id: '1', doc: { id: '1' }, at: 'x' }, { tbl: 'a', op: 'clear', at: 'x' }] })
    loop.stop()
    await d.tickets.put(mkTicket({ id: 'mine' }))
    expect(await run()).toBe('restored')
    expect(await d.tickets.count()).toBe(0)
    expect(store.state().tables.tickets).toBeUndefined()
  })
})

describe('I7: hydrate never loses a write that races it', () => {
  it('a write landing between the flush and the replace aborts the replace; the retry keeps it', async () => {
    store.applyOps({ clientId: 'other', ops: [{ tbl: 'tickets', op: 'put', id: 'srv', doc: mkTicket({ id: 'srv' }), at: 'x' }] })
    loop.stop()
    await adopted()
    let injected = false
    const racing: typeof fetch = async (i, init) => {
      if (String(i).endsWith('/db/state') && !injected) {
        injected = true
        await d.tickets.put(mkTicket({ id: 'raced', status: 'done' })) // e.g. a tick while /db/state is in flight
      }
      return fakeServer(i, init)
    }
    const l = createSyncLoop({ db: d, clientId: 'c', fetchImpl: racing, debounceMs: 60_000, backoffMs: [10], pollMs: 60_000, adoptedDb: store.health().dbId })
    expect(await hydrate({ db: d, gate, loop: l, clientId: 'c', fetchImpl: racing })).toBe('restored')
    expect((await d.tickets.get('raced'))?.status).toBe('done')
    expect((store.state().tables.tickets as { id: string }[]).map(t => t.id).sort()).toEqual(['raced', 'srv'])
    expect(await d._outbox.count()).toBe(0)
    l.stop()
  })

})

describe('I2: no destructive replace while changes are parked', () => {
  it('an adopted boot keeps Dexie as it is when rejectedOps is non-empty', async () => {
    store.applyOps({ clientId: 'other', ops: [{ tbl: 'tickets', op: 'put', id: 'srv', doc: mkTicket({ id: 'srv' }), at: 'x' }] })
    loop.stop()
    await adopted()
    gate.bypass = true
    await d.tickets.put(mkTicket({ id: 'refused-locally', status: 'done' }))
    gate.bypass = false
    await d._meta.put({ key: 'rejectedOps', value: [{ opId: 'x', tbl: 'tickets', op: 'put', id: 'refused-locally', doc: {}, at: 'x' }] })
    expect(await run()).toBe('kept')
    expect((await d.tickets.get('refused-locally'))?.status).toBe('done')
  })
})

describe('I10: hydrate never hangs', () => {
  const hangOn = (suffix: string): typeof fetch => async (i, init) => {
    if (!String(i).endsWith(suffix)) return fakeServer(i, init)
    return new Promise((_, reject) => { init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true }) })
  }
  it.each(['/db/ops', '/db/state'])('a hanging %s ends in "Not saved to disk", not a hang', async path => {
    store.applyOps({ clientId: 'other', ops: [{ tbl: 'tickets', op: 'put', id: 'srv', doc: mkTicket({ id: 'srv' }), at: 'x' }] })
    await adopted()
    loop.stop()
    await d.tickets.put(mkTicket({ id: 'mine' }))
    const f = hangOn(path)
    const l = createSyncLoop({ db: d, clientId: 'c', fetchImpl: f, backoffMs: [60_000], pollMs: 60_000, postTimeoutMs: 30, adoptedDb: store.health().dbId })
    const r = await hydrate({ db: d, gate, loop: l, clientId: 'c', fetchImpl: f, timeouts: { health: 30, state: 30 } })
    expect(['unreachable', 'failed']).toContain(r)
    expect(getSaveState()).toBe('offline')
    expect(await d.tickets.get('mine')).toBeTruthy()
    l.stop()
  })
})

describe('Minor 1: a stale restore flag is dropped only when no restore started after it', () => {
  const withBackups = (files: { file: string; at: string }[]): typeof fetch => async (i, init) => {
    if (String(i).endsWith('/db/backups')) return new Response(JSON.stringify({ backups: files.map(f => ({ ...f, bytes: 1 })) }), { status: 200 })
    return fakeServer(i, init)
  }
  const flagAt = Date.now() - 10 * 60_000

  it('a pre-restore file newer than the flag: the restore may still be finishing, stay paused', async () => {
    await adopted()
    await d._meta.put({ key: 'restoring', value: { fromDb: store.health().dbId, at: flagAt } })
    const f = withBackups([{ file: 'pre-restore-x.db', at: new Date(flagAt + 1000).toISOString() }])
    expect(await hydrate({ db: d, gate, loop, clientId: 'c', fetchImpl: f })).toBe('paused')
    expect(await d._meta.get('restoring')).toBeTruthy()
  })

  it('no such file: the flag was abandoned; it is dropped and the boot continues', async () => {
    await adopted()
    await d._meta.put({ key: 'restoring', value: { fromDb: store.health().dbId, at: flagAt } })
    const f = withBackups([{ file: 'pre-restore-old.db', at: new Date(flagAt - 60_000).toISOString() }])
    expect(await hydrate({ db: d, gate, loop, clientId: 'c', fetchImpl: f })).toBe('restored')
    expect(await d._meta.get('restoring')).toBeUndefined()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openSqlite, runMigrations } from '../../server/db/adapter.mjs'
import { createStore, DbError, type Store } from '../../server/db/store.mjs'
import { createDb, type DojoDB, type SettingsRow } from '../../src/data/db'
import { hydrate } from '../../src/data/sync/hydrate'
import { createSyncLoop, type SyncLoop } from '../../src/data/sync/loop'
import { installOutbox, type SyncGate } from '../../src/data/sync/middleware'
import { getSaveReason, getSaveState } from '../../src/data/sync/status'
import type { Ticket } from '../../src/data/types'
import { mkTicket } from '../helpers/tickets'

// C2: a browser only syncs to the server DB it adopted (_meta.syncedDb === the server's db_id).
let store: Store
let mode: 'up' | 'down' | 'slow'
let forced: Record<string, number> = {}
let d: DojoDB
let gate: SyncGate
let loop: SyncLoop
let n = 0

function newStore(): Store {
  const a = openSqlite(':memory:')
  runMigrations(a)
  return createStore(() => a)
}
const fetchImpl: typeof fetch = async (input, init) => {
  const path = new URL(String(input), 'http://x').pathname
  if (mode === 'down') throw new TypeError('fetch failed')
  if (mode === 'slow') {
    return new Promise((_, reject) => {
      const s = init?.signal
      if (!s) return // hangs forever: the caller must pass a timeout signal
      s.addEventListener('abort', () => reject(s.reason), { once: true })
    })
  }
  const reply = (status: number, b: unknown) => new Response(JSON.stringify(b), { status })
  if (forced[path]) return reply(forced[path], { ok: false, error: { code: 'forced', message: `forced ${forced[path]}` } })
  const body = init?.body ? JSON.parse(String(init.body)) : null
  try {
    if (path === '/db/health') return reply(200, store.health())
    if (path === '/db/state') return reply(200, store.state())
    if (path === '/db/ops') return reply(200, store.applyOps(body))
  } catch (e) {
    if (e instanceof DbError) return reply(e.status, { ok: false, error: { code: e.code, message: e.message } })
    throw e
  }
  return reply(404, {})
}
const run = () => hydrate({ db: d, gate, loop, clientId: 'me', fetchImpl, timeouts: { health: 30, state: 30 } })
const serverTickets = () => (store.state().tables.tickets ?? []) as Ticket[]
const serverSettings = () => (store.state().tables.settings ?? []) as SettingsRow[]

async function browser() {
  d = createDb(`adopt-${n++}`)
  gate = { bypass: false, clientId: 'me' }
  installOutbox(d, gate)
  await d.open()
  await d._meta.put({ key: 'clientId', value: 'me' })
  loop?.stop()
  loop = createSyncLoop({ db: d, clientId: 'me', fetchImpl, debounceMs: 1, backoffMs: [5], pollMs: 60_000, adoptedDb: null, onMismatch: () => {} })
  gate.onQueued = rows => loop.queued(rows)
}
/** The app's first boot writes: default plan tickets and settings with no start date. */
async function seedDefaults() {
  await d.tickets.bulkPut([mkTicket({ id: 'p1' }), mkTicket({ id: 'p2' })])
  await d.settings.put({ id: 'main', startDate: '', planVersion: '', aiProviders: {}, possibleXp: 0 })
}
/** Another browser already saved real progress to this server. */
function serverHasProgress() {
  store.applyOps({ clientId: 'other', ops: [
    { tbl: 'tickets', op: 'put', id: 'p1', doc: mkTicket({ id: 'p1', status: 'done' }), at: 'x' },
    { tbl: 'settings', op: 'put', id: 'main', doc: { id: 'main', startDate: '2026-10-05', planVersion: '', aiProviders: {}, possibleXp: 0 }, at: 'x' },
  ] })
}

beforeEach(async () => {
  store = newStore()
  mode = 'up'
  forced = {}
  await browser()
})
afterEach(() => loop.stop())

describe('C2: the server DB identity', () => {
  it('health reports a stable dbId and counts tombstones as docs', () => {
    const h = store.health() as { dbId: string; docs: number }
    expect(h.dbId).toMatch(/\S{8,}/)
    store.applyOps({ clientId: 'x', ops: [{ tbl: 'a', op: 'put', id: '1', doc: { id: '1' }, at: 'x' }, { tbl: 'a', op: 'clear', at: 'x' }] })
    expect(store.health()).toMatchObject({ dbId: h.dbId, docs: 1 })
  })

  it('ops stamped with another dbId are refused with 409 db_mismatch', () => {
    expect(() => store.applyOps({ clientId: 'c', dbId: 'not-this-db', ops: [] })).toThrowError(expect.objectContaining({ status: 409, code: 'db_mismatch' }))
  })
})

// Addendum 3: one writer, fresh start. Nothing is imported or merged: either this browser's database
// has recorded everything since it was created and the disk is empty (fresh start: send the outbox),
// or the disk wins.
describe('single writer: which state wins at boot', () => {
  it('fresh start: a never-synced browser on an empty disk sends everything it recorded', async () => {
    await seedDefaults()
    expect(await run()).toBe('fresh')
    expect(serverTickets().map(t => t.id)).toEqual(['p1', 'p2'])
    expect(serverSettings()[0].id).toBe('main')
    expect((await d._meta.get('syncedDb'))?.value).toBe(store.health().dbId)
    expect(await d._outbox.count()).toBe(0)
    await d.tickets.update('p2', { status: 'done' })
    expect(await loop.flush()).toBe(true)
    expect(serverTickets().find(t => t.id === 'p2')?.status).toBe('done')
  })

  it('(a) the server is down at first boot: nothing is posted, and it all arrives when it appears', async () => {
    mode = 'down'
    await seedDefaults()
    expect(await run()).toBe('unreachable')
    await d.tickets.update('p2', { status: 'done' })
    mode = 'up'
    expect(await loop.flush()).toBe(false) // not adopted yet
    expect(store.health().ops).toBe(0)
    expect(await run()).toBe('fresh')
    expect(serverTickets().map(t => [t.id, t.status])).toEqual([['p1', 'todo'], ['p2', 'done']])
  })

  it('(b) a new browser on a disk that has data never sends its seed defaults: the disk wins', async () => {
    serverHasProgress()
    mode = 'slow'
    expect(await run()).toBe('unreachable')
    await seedDefaults() // the app renders and seeds while the server is still slow
    mode = 'up'
    expect(await loop.flush()).toBe(false)
    expect(await run()).toBe('restored')
    expect(serverTickets().find(t => t.id === 'p1')?.status).toBe('done')
    expect(serverSettings()[0].startDate).toBe('2026-10-05')
    expect((await d.tickets.get('p1'))?.status).toBe('done')
    expect((await d.settings.get('main'))?.startDate).toBe('2026-10-05')
    expect(await d._outbox.count()).toBe(0)
    expect(store.health().ops).toBe(2)
  })

  it('(c) a tombstones-only disk counts as having data: the disk wins, nothing is sent', async () => {
    store.applyOps({ clientId: 'x', ops: [{ tbl: 'tickets', op: 'put', id: 'old', doc: { id: 'old' }, at: 'x' }, { tbl: 'tickets', op: 'clear', at: 'x' }] })
    await d.tickets.put(mkTicket({ id: 'mine', status: 'done' }))
    expect(await run()).toBe('restored')
    expect(await d.tickets.count()).toBe(0)
    expect(store.health().ops).toBe(2)
  })

  it('a database swapped under a synced browser: nothing is posted, the disk wins', async () => {
    await seedDefaults()
    expect(await run()).toBe('fresh')
    await d.tickets.update('p2', { status: 'done' })
    store = newStore() // dojo.db replaced by another database with other data
    serverHasProgress()
    expect(await loop.flush()).toBe(false) // stamped with the old dbId: refused
    expect(store.health().ops).toBe(2)
    expect(await run()).toBe('restored')
    expect(store.health().ops).toBe(2)
    expect((await d.tickets.get('p1'))?.status).toBe('done')
    expect(await d.tickets.get('p2')).toBeUndefined()
  })

  it('ping re-checks the dbId and re-adopts on a mismatch instead of posting', async () => {
    await seedDefaults()
    expect(await run()).toBe('fresh')
    const onMismatch = vi.fn()
    loop.stop()
    loop = createSyncLoop({ db: d, clientId: 'me', fetchImpl, debounceMs: 1, backoffMs: [5], pollMs: 5, adoptedDb: (await d._meta.get('syncedDb'))!.value as string, onMismatch })
    store = newStore()
    loop.start()
    await vi.waitFor(() => expect(onMismatch).toHaveBeenCalled())
    expect(store.health().ops).toBe(0)
  })
})

describe('N1: the page-hide keepalive never replays rows adoption dropped', () => {
  const settle = () => new Promise(r => setTimeout(r, 30))

  it('repro 1: the C2(b) boot, then a page hide, keeps the disk at done / 2026-10-05', async () => {
    serverHasProgress()
    mode = 'slow'
    expect(await run()).toBe('unreachable')
    await seedDefaults()
    mode = 'up'
    expect(await run()).toBe('restored')
    loop.flushOnHide()
    await settle()
    expect(serverTickets().find(t => t.id === 'p1')?.status).toBe('done')
    expect(serverSettings()[0].startDate).toBe('2026-10-05')
  })

  it('repro 2: an edit made before the first sync is not re-sent after a later edit was saved', async () => {
    mode = 'down'
    await d.tickets.put(mkTicket({ id: 'p1' }))
    expect(await run()).toBe('unreachable')
    await d.tickets.update('p1', { status: 'doing' })
    mode = 'up'
    expect(await run()).toBe('fresh')
    await d.tickets.update('p1', { status: 'done' })
    expect(await loop.flush()).toBe(true)
    loop.flushOnHide()
    await settle()
    expect(serverTickets().find(t => t.id === 'p1')?.status).toBe('done')
  })
})

describe('I-a: the hide path sends only when memory mirrors the whole outbox', () => {
  const settle = () => new Promise(r => setTimeout(r, 30))

  it('an outbox row left from an earlier page load is not overtaken by a newer write sent on hide', async () => {
    await seedDefaults()
    expect(await run()).toBe('fresh')
    const dbId = store.health().dbId
    // an earlier page load wrote X v1 and closed before it was sent
    loop.stop()
    gate.onQueued = undefined
    await d.tickets.update('p1', { title: 'v1' })
    // this page load: a new loop, which has never seen that row
    loop = createSyncLoop({ db: d, clientId: 'me', fetchImpl, debounceMs: 60_000, backoffMs: [60_000], pollMs: 60_000, adoptedDb: dbId, onMismatch: () => {} })
    gate.onQueued = rows => loop.queued(rows)
    await d.tickets.update('p1', { title: 'v2' })
    loop.flushOnHide() // before the normal flush
    await settle()
    expect(await loop.flush()).toBe(true)
    expect(serverTickets().find(t => t.id === 'p1')?.title).toBe('v2')
  })

  it('after a flush empties the outbox, the hide path works again', async () => {
    await seedDefaults()
    expect(await run()).toBe('fresh')
    expect(await loop.flush()).toBe(true)
    loop.stop() // no debounced flush: only the hide path can send this
    loop.start()
    await vi.waitFor(async () => expect(await d._outbox.count()).toBe(0))
    await new Promise(r => setTimeout(r, 20))
    loop.stop()
    gate.onQueued = rows => loop.queued(rows)
    await d.tickets.update('p2', { title: 'hidden' })
    loop.flushOnHide()
    await settle()
    expect(serverTickets().find(t => t.id === 'p2')?.title).toBe('hidden')
  })
})

describe('retryRejected never lets an older parked op overwrite a newer one', () => {
  it('drops a parked op when a newer op for the same doc exists, re-queues the rest in order', async () => {
    await seedDefaults()
    expect(await run()).toBe('fresh')
    const dbId = store.health().dbId
    let refuse = true
    const refusing: typeof fetch = async (i, init) => {
      if (refuse && String(i).endsWith('/db/ops')) return new Response(JSON.stringify({ ok: false, error: { code: 'too_large', message: 'x' } }), { status: 413 })
      return fetchImpl(i, init)
    }
    loop.stop()
    loop = createSyncLoop({ db: d, clientId: 'me', fetchImpl: refusing, debounceMs: 60_000, backoffMs: [60_000], pollMs: 60_000, adoptedDb: dbId, onMismatch: () => {} })
    gate.onQueued = rows => loop.queued(rows)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await d.tickets.update('p1', { title: 'v1' })
    await d.tickets.update('p2', { title: 'only' })
    expect(await loop.flush()).toBe(true) // both parked
    expect((await loop.listRejected()).map(r => r.id)).toEqual(['p1', 'p2'])
    refuse = false
    await d.tickets.update('p1', { title: 'v2' })
    expect(await loop.flush()).toBe(true) // v2 is saved
    expect(await loop.retryRejected()).toBe(true)
    expect(serverTickets().find(t => t.id === 'p1')?.title).toBe('v2') // not rolled back to v1
    expect(serverTickets().find(t => t.id === 'p2')?.title).toBe('only')
    expect(await loop.listRejected()).toEqual([])
    spy.mockRestore()
  })
})

describe('Addendum 8: "Saved" only when the server has every earlier change', () => {
  it('each time the loop says Saved, the disk already holds every change made before it', async () => {
    await seedDefaults()
    expect(await run()).toBe('fresh')
    const dbId = store.health().dbId
    const made: string[] = []
    const violations: string[] = []
    let delay = 0
    const slow: typeof fetch = async (i, init) => {
      if (delay) await new Promise(r => setTimeout(r, delay))
      return fetchImpl(i, init)
    }
    loop.stop()
    loop = createSyncLoop({
      db: d, clientId: 'me', fetchImpl: slow, debounceMs: 5, backoffMs: [5], pollMs: 60_000, adoptedDb: dbId, onMismatch: () => {},
      setState: st => {
        if (st !== 'saved') return
        // the latest change made so far must already be on disk (later titles overwrite earlier ones)
        const latest = made.at(-1)
        const disk = serverTickets().find(t => t.id === 'p1')?.title
        if (latest && `p1:${disk}` !== latest) violations.push(`saved with ${disk} while ${latest} was made`)
      },
    })
    gate.onQueued = rows => loop.queued(rows)
    delay = 20
    for (let i = 0; i < 6; i++) {
      await d.tickets.update('p1', { title: `v${i}` })
      made.push(`p1:v${i}`)
      await new Promise(r => setTimeout(r, 7))
    }
    await vi.waitFor(async () => expect(await d._outbox.count()).toBe(0))
    await loop.flush()
    expect(violations).toEqual([]) // no "Saved" while any earlier change was unacknowledged
    expect(serverTickets().find(t => t.id === 'p1')?.title).toBe('v5')
  })
})

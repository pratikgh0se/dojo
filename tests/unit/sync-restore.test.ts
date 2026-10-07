import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSqlite, runMigrations } from '../../server/db/adapter.mjs'
import { createStore, DbError, type Store } from '../../server/db/store.mjs'
import { createDb, type DojoDB } from '../../src/data/db'
import { startDiskSync, type DiskSync } from '../../src/data/sync/boot'
import type { SyncGate } from '../../src/data/sync/middleware'
import { mkTicket } from '../helpers/tickets'

// I-c: a restore started in one window must not be partly undone by another Dojo window that still
// holds (or keeps writing) the pre-restore data. Two tabs share one IndexedDB database.
const mk = () => { const a = openSqlite(':memory:'); runMigrations(a); return createStore(() => a) }
let store: Store
let imports: unknown[]
const fetchImpl: typeof fetch = async (input, init) => {
  const path = new URL(String(input), 'http://x').pathname
  const body = init?.body ? JSON.parse(String(init.body)) : null
  const reply = (status: number, b: unknown) => new Response(JSON.stringify(b), { status })
  try {
    if (path === '/db/health') return reply(200, store.health())
    if (path === '/db/state') return reply(200, store.state())
    if (path === '/db/ops') return reply(200, store.applyOps(body))
    if (path === '/db/import') { imports.push(body); return reply(404, {}) }
  } catch (e) {
    if (e instanceof DbError) return reply(e.status, { ok: false, error: { code: e.code, message: e.message } })
    throw e
  }
  return reply(404, {})
}
let tabs: DiskSync[] = []
afterEach(() => { for (const t of tabs) t.loop?.stop(); tabs = [] })
let n = 0

async function twoTabs() {
  const name = `restore-${n++}`
  const channel = `dojo-sync-${name}`
  const reloads = { a: vi.fn(), b: vi.fn() }
  const open = async (reload: () => void) => {
    const gate: SyncGate = { bypass: false }
    const d: DojoDB = createDb(name, gate)
    const s = await startDiskSync(d, { fetchImpl, gate, channelName: channel, reload, pollMs: 20 })
    tabs.push(s)
    return { d, s }
  }
  const a = await open(reloads.a)
  const b = await open(reloads.b)
  /** A reload: a new page, so a new database instance and gate on the same IndexedDB database. */
  const reboot = async () => {
    const gate: SyncGate = { bypass: false }
    const d = createDb(name, gate)
    const s = await startDiskSync(d, { fetchImpl, gate, channelName: `${channel}-after`, reload: () => {} })
    tabs.push(s)
    return { d, s }
  }
  return { a, b, reloads, reboot }
}

describe('I-c: a restore suspends every tab', () => {
  it('another tab never merges the pre-restore copy into the restored database; all tabs reload', async () => {
    store = mk()
    imports = []
    const { a, b, reloads, reboot } = await twoTabs()
    await a.d.tickets.put(mkTicket({ id: 'after-backup', status: 'done' }))
    expect(await a.s.controls!.flush()).toBe(true)
    imports = []
    const cancel = await a.s.controls!.beginRestore()
    expect(typeof cancel).toBe('function')
    store = mk() // the server swapped in the backup: a new db_id, without 'after-backup'
    // tab B tries to write (refused: G4 #3), and its loop keeps pinging, during the restore
    await vi.waitFor(async () => { await expect(b.d.tickets.put(mkTicket({ id: 'b-during', status: 'done' }))).rejects.toThrow(/^Read-only/) })
    await new Promise(r => setTimeout(r, 150))
    expect(imports).toEqual([])
    expect(store.health().ops).toBe(0)
    await a.s.controls!.wipeLocal()
    expect(await a.d._meta.get('syncedDb')).toBeUndefined()
    await vi.waitFor(() => expect(reloads.b).toHaveBeenCalled())
    // after the reloads: the next boot finishes the restore from the (restored) disk
    tabs.forEach(t => t.loop?.stop())
    const c = await reboot()
    expect(c.s.result).toBe('restored')
    expect(imports).toEqual([])
    expect(await c.d.tickets.get('after-backup')).toBeUndefined()
    expect(await c.d._meta.get('restoring')).toBeUndefined()
  })

  it('a failed restore cancels: the flag is cleared and the tabs sync again', async () => {
    store = mk()
    imports = []
    const { a, b } = await twoTabs()
    const cancel = await a.s.controls!.beginRestore()
    await cancel!()
    expect(await a.d._meta.get('restoring')).toBeUndefined()
    await b.d.tickets.put(mkTicket({ id: 'x' }))
    await vi.waitFor(async () => expect(await b.s.controls!.flush()).toBe(true))
    expect((store.state().tables.tickets as { id: string }[]).map(t => t.id)).toContain('x')
  })

  it('if the wipe fails after the restore, the next boot finishes it without merging the old copy', async () => {
    store = mk()
    imports = []
    const { a, reboot } = await twoTabs()
    await a.d.tickets.put(mkTicket({ id: 'old', status: 'done' }))
    expect(await a.s.controls!.flush()).toBe(true)
    await a.s.controls!.beginRestore()
    store = mk() // restored, but this tab never wiped (e.g. it crashed)
    tabs.forEach(t => t.loop?.stop())
    imports = []
    const c = await reboot()
    expect(c.s.result).toBe('restored')
    expect(imports).toEqual([])
    expect(await c.d.tickets.get('old')).toBeUndefined()
    expect(store.health().docs).toBe(0)
  })
})

describe('G4 #3: nothing is accepted while a restore runs', () => {
  it('beginRestore makes every tab refuse writes (the Read-only refusal) until cancelled', async () => {
    store = mk()
    imports = []
    const { a, b } = await twoTabs()
    const cancel = await a.s.controls!.beginRestore()
    expect(cancel).toBeTypeOf('function')
    await expect(a.d.tickets.put(mkTicket({ id: 'during-a' }))).rejects.toThrow(/^Read-only/)
    await vi.waitFor(async () => { await expect(b.d.tickets.put(mkTicket({ id: 'during-b' }))).rejects.toThrow(/^Read-only/) })
    await cancel!()
    await a.d.tickets.put(mkTicket({ id: 'after-a' }))
    await vi.waitFor(async () => { await b.d.tickets.put(mkTicket({ id: 'after-b' })) })
    expect(await a.d.tickets.get('during-a')).toBeUndefined()
  })

  it('pending changes that cannot be saved abort it before anything starts (no flag, writes allowed)', async () => {
    store = mk()
    const { a } = await twoTabs()
    store = mk() // the server now answers with another db: the flush cannot save
    await a.d.tickets.put(mkTicket({ id: 'pending' }))
    expect(await a.s.controls!.beginRestore()).toBeNull()
    expect(await a.d._meta.get('restoring')).toBeUndefined()
    await a.d.tickets.put(mkTicket({ id: 'still-writable' }))
  })
})

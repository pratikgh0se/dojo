import { afterEach, describe, expect, it, vi } from 'vitest'
import { db, syncGate } from '../../src/data/db'
import { startDisk } from '../../src/data/sync/entry'
import { getSaveReason, getSaveState, setSaveState } from '../../src/data/sync/status'
import { mkTicket } from '../helpers/tickets'

// I8: the outbox middleware is part of db.ts, so no write can happen before it is installed
// (the lazy sync chunk used to install it, after App code could already have opened the db).
afterEach(async () => {
  setSaveState('off')
  syncGate.onQueued = undefined
  await db.delete()
  await db.open()
})

describe('I8: the outbox is installed statically', () => {
  it('a write on the app db is queued without the lazy sync code ever loading', async () => {
    await db.tickets.put(mkTicket({ id: 'early' }))
    expect((await db._outbox.toArray()).map(r => r.id)).toEqual(['early'])
  })

  it('starting disk sync does not install it twice (one op per write)', async () => {
    const down: typeof fetch = async () => { throw new TypeError('down') }
    const { startDiskSync } = await import('../../src/data/sync/boot')
    const s = await startDiskSync(db, { fetchImpl: down, channelName: 'static-1', reload: () => {} })
    await db.tickets.put(mkTicket({ id: 'once' }))
    expect(await db._outbox.count()).toBe(1)
    s.loop?.stop()
  })

  it('I10: a sync start that never finishes lets the app render within the boot budget', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t0 = Date.now()
    await startDisk(async () => ({ startDiskSync: () => new Promise(() => {}) }), 50)
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(getSaveState()).toBe('offline')
    spy.mockRestore()
  })

  it('a lazy sync chunk that fails to load shows "Not saved to disk"', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await startDisk(async () => { throw new TypeError('Failed to fetch dynamically imported module') })
    expect(getSaveState()).toBe('offline')
    expect(getSaveReason()).toMatch(/failed to load/i)
    spy.mockRestore()
  })
})

describe('a restore pauses sync so pre-restore data cannot merge back', () => {
  it('after suspend, a db_mismatch neither re-adopts nor blocks the wipe', async () => {
    const { openSqlite, runMigrations } = await import('../../server/db/adapter.mjs')
    const { createStore, DbError } = await import('../../server/db/store.mjs')
    const mk = () => { const a = openSqlite(':memory:'); runMigrations(a); return createStore(() => a) }
    let store = mk()
    const imports: unknown[] = []
    const f: typeof fetch = async (input, init) => {
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
    const { startDiskSync } = await import('../../src/data/sync/boot')
    const { syncControls } = await import('../../src/data/sync/status')
    await db.tickets.put(mkTicket({ id: 'before' }))
    const s = await startDiskSync(db, { fetchImpl: f, channelName: 'static-2', reload: () => {} })
    expect(s.result).toBe('fresh')
    imports.length = 0
    const cancel = await syncControls.beginRestore()
    store = mk() // the server restored a backup: a new db_id
    await expect(db.tickets.put(mkTicket({ id: 'during', status: 'done' }))).rejects.toThrow(/^Read-only/) // G4 #3
    expect(await syncControls.flush()).toBe(false) // nothing is posted while suspended
    await syncControls.wipeLocal()
    expect(await db.tickets.count()).toBe(0)
    expect(imports).toEqual([]) // no merge of the old data into the restored database
    expect(store.health().docs).toBe(0)
    await cancel!()
    s.loop?.stop()
  })
})

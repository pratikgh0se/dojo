// R2 W7: Dexie v12 drops artifacts, stageCells and blankTests, AFTER a backup (migration.md MIG-31 to MIG-35). A real-shaped v11 database
// with rows in all three tables is rehearsed against a fake server: the server is read, the backup is taken first, the server's documents
// are cleared, the tables go, every other table is identical, and a second launch is a no-op. Against the real server: db-v12-server.test.ts.
import { describe, expect, it } from 'vitest'
import { createDb, DB_VERSION, SCHEMA_V12, type DojoDB } from '../../src/data/db'
import { prepareLegacyDrop, probeStored } from '../../src/data/legacyDrop'
import { mkTicket } from '../helpers/tickets'

const GONE = Object.keys(SCHEMA_V12)
const name = () => `v12-${Math.random().toString(36).slice(2)}`
const held = (n: string): DojoDB => createDb(n, undefined, { holdV12: true })

/** A server that holds `live` documents per legacy table and records every call in order. */
function fakeServer(live: Record<string, number>, fail: { state?: boolean; backup?: boolean; ops?: boolean } = {}) {
  const calls: string[] = []
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const f = (async (url: string, init?: RequestInit) => {
    calls.push(String(url))
    if (url === '/db/state') return fail.state ? json({}, 500) : json({ tables: Object.fromEntries(Object.entries(live).filter(([, n]) => n > 0).map(([t, n]) => [t, Array.from({ length: n }, (_, i) => ({ id: `${t}-${i}` }))])) })
    if (url === '/db/backup') return fail.backup ? json({}, 500) : json({ ok: true, file: 'dojo-2026-10-15-101500.db' })
    if (url === '/db/ops') {
      if (fail.ops) return json({}, 500)
      for (const o of JSON.parse(String(init?.body)).ops as { tbl: string; op: string }[]) if (o.op === 'clear') live[o.tbl] = 0
      return json({ ok: true })
    }
    return json({}, 404)
  }) as unknown as typeof fetch
  return { f, calls, live }
}

/** A v11 database shaped like a live one: rows in the three legacy tables and in the tables around them. */
async function seedLive(n: string): Promise<void> {
  const d = held(n)
  await d.open()
  await d.tickets.bulkPut([mkTicket({ id: 'p127', kind: 'problem', status: 'done', doneAt: 5, xp: 10 }), mkTicket({ id: 'ai.u1.build', kind: 'build' })])
  await d.sessions.put({ id: 's1', ticketId: 'p127', start: 1, end: 5, minutes: 30, outcome: 'solved', xpDelta: 10 })
  await d.redos.put({ id: 'rd1', ticketId: 'p127', source: 'gave_up', createdAt: 3, stage: 0, due: 4, passed: [], helpCost: 10, refunded: 0 })
  await d.settings.put({ id: 'main', startDate: '2026-10-05', planVersion: 'p', aiProviders: {}, possibleXp: 0, navLabels: 'always' })
  await d._meta.put({ key: 'clientId', value: 'c-1' })
  await d.table('artifacts').put({ id: 'art-stage-00', title: 'Setup', block: 1, stage: 0, status: 'measured', statusAt: { measured: 10 }, measures: [] })
  await d.table('stageCells').put({ id: '0:build', stage: 0, cell: 'build', at: 12, evidence: 'c0ffee1', via: 'commit' })
  await d.table('blankTests').put({ id: 'bt1', stage: 1, piece: 'backward pass', at: 13, minutes: 25, outcome: 'not_yet' })
  d.close()
}
const dumpOthers = async (d: DojoDB) => Object.fromEntries(await Promise.all(d.tables.filter(t => !GONE.includes(t.name)).map(async t => [t.name, await t.toArray()] as const)))

describe('Dexie v12', () => {
  it('declares v12 by default and holds back on request', async () => {
    expect(DB_VERSION).toBe(12)
    const a = createDb(name())
    await a.open()
    expect(a.verno).toBe(12)
    expect(a.tables.map(t => t.name).filter(t => GONE.includes(t))).toEqual([])
    a.close()
    const b = held(name())
    await b.open()
    expect(b.verno).toBe(11)
    expect(b.tables.map(t => t.name)).toEqual(expect.arrayContaining(GONE))
    b.close()
  })

  it('probeStored reports no database, then the version and the legacy rows', async () => {
    const n = name()
    expect(await probeStored(n)).toEqual({ version: null, legacyRows: 0 })
    await seedLive(n)
    expect(await probeStored(n)).toEqual({ version: 11, legacyRows: 3 })
  })

  it('rehearsal: the server is read, the backup comes first, its documents are cleared, the tables go, nothing else changes, a second launch is a no-op', async () => {
    const n = name()
    await seedLive(n)
    const d1 = held(n)
    await d1.open()
    const snapshot = await dumpOthers(d1)
    d1.close()

    const srv = fakeServer({ artifacts: 3, stageCells: 2, blankTests: 2 })
    const d2 = held(n)
    const res = await prepareLegacyDrop(d2, { fetchImpl: srv.f, readOnly: false, disk: true })
    expect(res).toEqual({ status: 'declared', backupFile: 'dojo-2026-10-15-101500.db' })
    expect(srv.calls).toEqual(['/db/state', '/db/backup', '/db/ops']) // the backup is before the clear, both before v12 is declared
    expect(srv.live).toEqual({ artifacts: 0, stageCells: 0, blankTests: 0 })
    await d2.open()
    expect(d2.verno).toBe(12)
    expect(d2.tables.map(t => t.name).filter(t => GONE.includes(t))).toEqual([])
    expect(await dumpOthers(d2)).toEqual(snapshot)
    d2.close()

    const again = fakeServer({ artifacts: 0, stageCells: 0, blankTests: 0 })
    const d3 = held(n)
    expect(await prepareLegacyDrop(d3, { fetchImpl: again.f, readOnly: false, disk: true })).toEqual({ status: 'declared', backupFile: null })
    expect(again.calls).toEqual([]) // already v12: no read, no backup, no write
    await d3.open()
    expect(d3.verno).toBe(12)
    expect(await dumpOthers(d3)).toEqual(snapshot)
    d3.close()
  })

  it('a failed backup holds v11: the rows and the server documents stay, nothing is cleared, and the next launch retries (MIG-35)', async () => {
    const n = name()
    await seedLive(n)
    const srv = fakeServer({ artifacts: 3, stageCells: 2, blankTests: 2 }, { backup: true })
    const d1 = held(n)
    const res = await prepareLegacyDrop(d1, { fetchImpl: srv.f, readOnly: false, disk: true })
    expect(res).toMatchObject({ status: 'held', backupFile: null })
    expect(res.reason).toContain('changed nothing')
    expect(srv.calls).not.toContain('/db/ops')
    expect(srv.live).toEqual({ artifacts: 3, stageCells: 2, blankTests: 2 })
    await d1.open()
    expect(d1.verno).toBe(11)
    d1.close()
    expect(await probeStored(n)).toEqual({ version: 11, legacyRows: 3 })

    srv.live.artifacts = 3
    const ok = fakeServer({ artifacts: 3, stageCells: 2, blankTests: 2 })
    const d2 = held(n)
    expect(await prepareLegacyDrop(d2, { fetchImpl: ok.f, readOnly: false, disk: true })).toEqual({ status: 'declared', backupFile: 'dojo-2026-10-15-101500.db' })
    await d2.open()
    expect(d2.verno).toBe(12)
    d2.close()
  })

  it('a clear that fails after the backup also holds v11', async () => {
    const n = name()
    await seedLive(n)
    const srv = fakeServer({ artifacts: 3, stageCells: 2, blankTests: 2 }, { ops: true })
    const d1 = held(n)
    expect(await prepareLegacyDrop(d1, { fetchImpl: srv.f, readOnly: false, disk: true })).toMatchObject({ status: 'held', backupFile: null })
    await d1.open()
    expect(d1.verno).toBe(11)
    d1.close()
  })

  it('a fresh browser still backs up and clears when the server holds legacy documents (MIG-31 opens the writer URL in a new profile)', async () => {
    const srv = fakeServer({ artifacts: 3, stageCells: 2, blankTests: 2 })
    const d = held(name())
    expect(await prepareLegacyDrop(d, { fetchImpl: srv.f, readOnly: false, disk: true })).toEqual({ status: 'declared', backupFile: 'dojo-2026-10-15-101500.db' })
    expect(srv.calls).toEqual(['/db/state', '/db/backup', '/db/ops'])
    await d.open()
    expect(d.verno).toBe(12)
    d.close()
  })

  it('a fresh browser and a server with no legacy documents take no backup and write nothing (MIG-28)', async () => {
    const srv = fakeServer({})
    const d = held(name())
    expect(await prepareLegacyDrop(d, { fetchImpl: srv.f, readOnly: false, disk: true })).toEqual({ status: 'declared', backupFile: null })
    expect(srv.calls).toEqual(['/db/state'])
    await d.open()
    expect(d.verno).toBe(12)
    d.close()
  })

  it('an unreadable server holds v11 and changes nothing', async () => {
    const n = name()
    await seedLive(n)
    const srv = fakeServer({ artifacts: 3 }, { state: true })
    const d = held(n)
    const res = await prepareLegacyDrop(d, { fetchImpl: srv.f, readOnly: false, disk: true })
    expect(res).toMatchObject({ status: 'held' })
    expect(srv.calls).toEqual(['/db/state'])
    await d.open()
    expect(d.verno).toBe(11)
    d.close()
  })

  it('a Dexie-only run (no server) drops without a backup; a read-only browser holds; an open database is left alone', async () => {
    const n = name()
    await seedLive(n)
    const srv = fakeServer({})
    const dexieOnly = held(n)
    expect(await prepareLegacyDrop(dexieOnly, { fetchImpl: srv.f, readOnly: false, disk: false })).toEqual({ status: 'declared', backupFile: null })
    expect(srv.calls).toEqual([])
    dexieOnly.close()

    const m = name()
    await seedLive(m)
    const ro = held(m)
    expect(await prepareLegacyDrop(ro, { fetchImpl: srv.f, readOnly: true, disk: true })).toMatchObject({ status: 'held', reason: 'read-only browser' })
    await ro.open()
    expect(ro.verno).toBe(11)
    ro.close()

    const o = held(name())
    await o.open()
    expect(await prepareLegacyDrop(o, { fetchImpl: srv.f, readOnly: false, disk: true })).toMatchObject({ status: 'held', reason: 'database already open' })
    o.close()
    expect(srv.calls).toEqual([])
  })
})

// C-PYTHON §4: v5 keyed `code` by ticketId; v7 keys it by (ticketId, lang). Existing Go rows survive.
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { createDb, DB_VERSION, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V7 } from '../../src/data/db'
import type { SyncGate } from '../../src/data/sync/middleware'
import { mkTicket } from '../helpers/tickets'

const dbName = () => `mig-code-${Math.random().toString(36).slice(2)}`

/** A real v5 browser: every version declared as shipped, with a Go code row per ticket. */
async function seedV5(name: string) {
  const v5 = new Dexie(name)
  v5.version(1).stores(SCHEMA_V1)
  v5.version(2).stores(SCHEMA_V2)
  v5.version(3).stores(SCHEMA_V3)
  v5.version(4).stores(SCHEMA_V4)
  v5.version(5).stores(SCHEMA_V5)
  await v5.open()
  const rows = [
    { ticketId: 'p91', lang: 'go', source: 'package main\n\nfunc numDecodings(s string) int {\n\treturn 0\n}\n', updatedAt: 1_700_000_000_000 },
    { ticketId: 'p198', lang: 'go', source: 'package main\n// mine\n', updatedAt: 1_700_000_100_000 },
  ]
  await v5.table('code').bulkPut(rows)
  await v5.table('tickets').put(mkTicket({ id: 'p91', kind: 'problem', status: 'doing' }))
  v5.close()
  return rows
}

describe('v5 → v7 code table migration', () => {
  it('declares the new compound key and drops the temp table', () => {
    expect(DB_VERSION).toBe(7)
    expect(SCHEMA_V7.code).toBe('[ticketId+lang]')
  })

  it('keeps every Go row exactly, re-keyed by (ticketId, lang), and the other tables', async () => {
    const name = dbName()
    const rows = await seedV5(name)
    const d = createDb(name)
    await d.open()
    expect(d.verno).toBe(7)
    expect(d.tables.map(t => t.name)).not.toContain('_codeTmp')
    expect((await d.code.toArray()).sort((a, b) => a.ticketId.localeCompare(b.ticketId))).toEqual([rows[1], rows[0]])
    expect(await d.code.get(['p91', 'go'])).toEqual(rows[0])
    expect(await d.code.get(['p91', 'py'])).toBeUndefined()
    expect(d.code.schema.primKey.keyPath).toEqual(['ticketId', 'lang'])
    expect((await d.tickets.get('p91'))?.status).toBe('doing')
    // a Python row can now sit beside the Go row of the same ticket
    await d.code.put({ ticketId: 'p91', lang: 'py', source: 'def numDecodings(s): ...', updatedAt: 5 })
    expect(await d.code.where('ticketId').equals('p91').count()).toBe(2)
    d.close()
  })

  it('opens an empty v5 database, and a brand new one', async () => {
    const empty = dbName()
    const v5 = new Dexie(empty)
    v5.version(1).stores(SCHEMA_V1); v5.version(2).stores(SCHEMA_V2); v5.version(3).stores(SCHEMA_V3); v5.version(4).stores(SCHEMA_V4); v5.version(5).stores(SCHEMA_V5)
    await v5.open(); v5.close()
    const d = createDb(empty)
    await d.open()
    expect(await d.code.count()).toBe(0)
    d.close()
    const fresh = createDb(dbName())
    await fresh.open()
    expect(await fresh.code.count()).toBe(0)
    fresh.close()
  })

  it('a read-only browser (gate.readOnly) migrates too, and queues nothing', async () => {
    const name = dbName()
    await seedV5(name)
    const gate: SyncGate = { bypass: false, readOnly: true }
    const d = createDb(name, gate)
    await d.open()
    expect(await d.code.count()).toBe(2)
    expect(await d._outbox.count()).toBe(0)
    expect(gate.bypass).toBe(false)
    // and the gate is back to refusing writes
    await expect(d.code.put({ ticketId: 'p62', lang: 'go', source: 'x', updatedAt: 1 })).rejects.toThrow()
    d.close()
  })

  it('a writer queues the new ids and retires the old ones on disk, in that order', async () => {
    const name = dbName()
    const rows = await seedV5(name)
    const gate: SyncGate = { bypass: false, readOnly: false }
    const d = createDb(name, gate)
    await d.open()
    const out = (await d._outbox.orderBy('seq').toArray()).filter(o => o.tbl === 'code')
    expect(out.map(o => [o.op, o.id])).toEqual([['put', 'p198:go'], ['put', 'p91:go'], ['delete', 'p198'], ['delete', 'p91']])
    expect(out[1].doc).toEqual(rows[0])
    expect(gate.bypass).toBe(false)
    // later writes are queued as usual
    await d.code.put({ ticketId: 'p91', lang: 'go', source: 'v2', updatedAt: 9 })
    const last = (await d._outbox.orderBy('seq').last())!
    expect([last.tbl, last.op, last.id]).toEqual(['code', 'put', 'p91:go'])
    d.close()
  })
})

// R1 W2: v9 only ADDS the `journal` table (the daily journal). It touches no existing data and the upgrade writes nothing.
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { createDb, DB_VERSION, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V7, SCHEMA_V8 } from '../../src/data/db'
import { mkTicket } from '../helpers/tickets'

const dbName = () => `mig-journal-${Math.random().toString(36).slice(2)}`

async function seedV8(name: string) {
  const v8 = new Dexie(name)
  v8.version(1).stores(SCHEMA_V1)
  v8.version(2).stores(SCHEMA_V2)
  v8.version(3).stores(SCHEMA_V3)
  v8.version(4).stores(SCHEMA_V4)
  v8.version(5).stores(SCHEMA_V5)
  v8.version(6).stores({ ...SCHEMA_V5, code: null, _codeTmp: '[ticketId+lang]' })
  v8.version(7).stores({ ...SCHEMA_V7, _codeTmp: null })
  v8.version(8).stores(SCHEMA_V8)
  await v8.open()
  await v8.table('tickets').bulkPut([mkTicket({ id: 'a', status: 'done', xp: 10 }), mkTicket({ id: 'b' })])
  await v8.table('pulses').put({ id: 'pulse-2026-11-03', day: '2026-11-03', at: 5, text: 'x' })
  await v8.table('settings').put({ id: 'main', startDate: '2026-09-07' })
  v8.close()
}

describe('v8 to v9 journal table', () => {
  it('is database version 10 (v9 added the journal, v10 the bank tables) and the journal table is keyed by id with a day index', async () => {
    expect(DB_VERSION).toBe(10)
    const d = createDb(dbName())
    await d.open()
    expect(d.verno).toBe(10)
    expect(d.journal.schema.primKey.keyPath).toBe('id')
    expect(d.journal.schema.idxByName.day).toBeDefined()
    d.close()
  })

  it('adds an empty table and leaves every existing row exactly as it was', async () => {
    const name = dbName()
    await seedV8(name)
    const d = createDb(name)
    await d.open()
    expect(await d.journal.count()).toBe(0)
    expect((await d.tickets.orderBy('id').toArray()).map(t => [t.id, t.status, t.xp])).toEqual([['a', 'done', 10], ['b', 'todo', 0]])
    expect(await d.pulses.get('pulse-2026-11-03')).toMatchObject({ text: 'x' })
    expect((await d.settings.get('main'))?.startDate).toBe('2026-09-07')
    expect(await d._outbox.count()).toBe(0) // the upgrade queued nothing for the disk
    d.close()
  })

  it('a v8 database opens at v10 with journal, bankGrades and bankExtra all empty and nothing queued (W2 v9 + W6 v10 together)', async () => {
    const name = dbName()
    await seedV8(name)
    const d = createDb(name)
    await d.open()
    expect(d.verno).toBe(10)
    expect([await d.journal.count(), await d.bankGrades.count(), await d.bankExtra.count()]).toEqual([0, 0, 0])
    expect(d.journal.schema.idxByName.day).toBeDefined()
    expect(d.bankGrades.schema.idxByName.area).toBeDefined()
    expect(d.bankExtra.schema.idxByName.node).toBeDefined()
    expect((await d.tickets.orderBy('id').toArray()).map(t => t.id)).toEqual(['a', 'b'])
    expect(await d._outbox.count()).toBe(0)
    d.close()
  })
})

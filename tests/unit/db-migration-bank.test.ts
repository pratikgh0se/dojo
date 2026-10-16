// W6: v10 only ADDS `bankGrades` and `bankExtra` (question banks). It touches no existing data and queues nothing for the disk.
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { createDb, DB_VERSION, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V7, SCHEMA_V8 } from '../../src/data/db'
import { mkTicket } from '../helpers/tickets'

const dbName = () => `mig-bank-${Math.random().toString(36).slice(2)}`

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
  await v8.table('tickets').bulkPut([mkTicket({ id: 'a', status: 'done', xp: 10 })])
  await v8.table('pulses').put({ id: 'pulse-2026-11-04', day: '2026-11-04', at: 1, text: 'x' })
  await v8.table('settings').put({ id: 'main', startDate: '2026-09-07' })
  v8.close()
}

describe('v8 to v10 question-bank tables', () => {
  it('declares bankGrades and bankExtra keyed by id with area and node indexes', async () => {
    expect(DB_VERSION).toBe(12)
    const d = createDb(dbName())
    await d.open()
    for (const t of [d.bankGrades, d.bankExtra]) {
      expect(t.schema.primKey.keyPath).toBe('id')
      expect(t.schema.idxByName.area).toBeDefined()
      expect(t.schema.idxByName.node).toBeDefined()
    }
    d.close()
  })

  it('adds two empty tables and leaves every existing row as it was', async () => {
    const name = dbName()
    await seedV8(name)
    const d = createDb(name)
    await d.open()
    expect(await d.bankGrades.count()).toBe(0)
    expect(await d.bankExtra.count()).toBe(0)
    expect((await d.tickets.toArray()).map(t => [t.id, t.status, t.xp])).toEqual([['a', 'done', 10]])
    expect(await d.pulses.count()).toBe(1)
    expect((await d.settings.get('main'))?.startDate).toBe('2026-09-07')
    expect(await d._outbox.count()).toBe(0)
    d.close()
  })
})

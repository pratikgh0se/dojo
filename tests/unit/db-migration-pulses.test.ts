// F1: v8 only ADDS the `pulses` table (the daily AI pulse log). It touches no existing data.
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { createDb, DB_VERSION, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V7 } from '../../src/data/db'
import { mkTicket } from '../helpers/tickets'

const dbName = () => `mig-pulses-${Math.random().toString(36).slice(2)}`

async function seedV7(name: string) {
  const v7 = new Dexie(name)
  v7.version(1).stores(SCHEMA_V1)
  v7.version(2).stores(SCHEMA_V2)
  v7.version(3).stores(SCHEMA_V3)
  v7.version(4).stores(SCHEMA_V4)
  v7.version(5).stores(SCHEMA_V5)
  v7.version(6).stores({ ...SCHEMA_V5, code: null, _codeTmp: '[ticketId+lang]' })
  v7.version(7).stores({ ...SCHEMA_V7, _codeTmp: null })
  await v7.open()
  await v7.table('tickets').bulkPut([mkTicket({ id: 'a', status: 'done', xp: 10 }), mkTicket({ id: 'b' })])
  await v7.table('code').put({ ticketId: 'a', lang: 'go', source: 'package main', updatedAt: 1 })
  await v7.table('settings').put({ id: 'main', startDate: '2026-09-07' })
  v7.close()
}

describe('v7 to v8 pulses table', () => {
  it('is database version 10 (v8 added pulses, v9 the journal, v10 the bank tables) and the pulses table is keyed by id with a day index', async () => {
    expect(DB_VERSION).toBe(10)
    const d = createDb(dbName())
    await d.open()
    expect(d.verno).toBe(10)
    expect(d.pulses.schema.primKey.keyPath).toBe('id')
    expect(d.pulses.schema.idxByName.day).toBeDefined()
    d.close()
  })

  it('adds an empty table and leaves every existing row exactly as it was', async () => {
    const name = dbName()
    await seedV7(name)
    const d = createDb(name)
    await d.open()
    expect(await d.pulses.count()).toBe(0)
    expect((await d.tickets.orderBy('id').toArray()).map(t => [t.id, t.status, t.xp])).toEqual([['a', 'done', 10], ['b', 'todo', 0]])
    expect(await d.code.get(['a', 'go'])).toMatchObject({ source: 'package main' })
    expect((await d.settings.get('main'))?.startDate).toBe('2026-09-07')
    expect(await d._outbox.count()).toBe(0) // the upgrade queued nothing for the disk
    d.close()
  })
})

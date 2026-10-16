// R2 v11 only ADDS the five new tables (labs, labRuns, labReviews, weeklyReviews, portfolioItems): no existing row changes, nothing is queued.
import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { createDb, DB_VERSION, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V7, SCHEMA_V8, SCHEMA_V10, SCHEMA_V11 } from '../../src/data/db'
import { mkTicket } from '../helpers/tickets'

const dbName = () => `mig-labs-${Math.random().toString(36).slice(2)}`

async function seedV10(name: string) {
  const v10 = new Dexie(name)
  v10.version(1).stores(SCHEMA_V1)
  v10.version(2).stores(SCHEMA_V2)
  v10.version(3).stores(SCHEMA_V3)
  v10.version(4).stores(SCHEMA_V4)
  v10.version(5).stores(SCHEMA_V5)
  v10.version(6).stores({ ...SCHEMA_V5, code: null, _codeTmp: '[ticketId+lang]' })
  v10.version(7).stores({ ...SCHEMA_V7, _codeTmp: null })
  v10.version(8).stores(SCHEMA_V8)
  v10.version(9).stores({ journal: 'id, day' })
  v10.version(10).stores({ bankGrades: SCHEMA_V10.bankGrades, bankExtra: SCHEMA_V10.bankExtra })
  await v10.open()
  await v10.table('tickets').bulkPut([mkTicket({ id: 'a', status: 'done', xp: 10 })])
  await v10.table('journal').put({ id: 'journal-2026-11-04', day: '2026-11-04', at: 1, mode: 'none', items: [] })
  await v10.table('settings').put({ id: 'main', startDate: '2026-09-07' })
  v10.close()
}

describe('v10 to v11 R2 tables', () => {
  it('declares the five tables with the spec keys and indexes', async () => {
    expect(DB_VERSION).toBe(12)
    expect(SCHEMA_V11).toMatchObject({ labs: 'labId', labRuns: 'id, labId, at', labReviews: 'id, labId, at', weeklyReviews: 'id', portfolioItems: 'id, labId' })
    const d = createDb(dbName())
    await d.open()
    expect(d.labs.schema.primKey.keyPath).toBe('labId')
    for (const t of [d.labRuns, d.labReviews]) {
      expect(t.schema.primKey.keyPath).toBe('id')
      expect(t.schema.idxByName.labId).toBeDefined()
      expect(t.schema.idxByName.at).toBeDefined()
    }
    expect(d.weeklyReviews.schema.primKey.keyPath).toBe('id')
    expect(d.portfolioItems.schema.idxByName.labId).toBeDefined()
    d.close()
  })

  it('adds five empty tables and leaves every existing row as it was, queueing nothing', async () => {
    const name = dbName()
    await seedV10(name)
    const d = createDb(name)
    await d.open()
    for (const t of [d.labs, d.labRuns, d.labReviews, d.weeklyReviews, d.portfolioItems]) expect(await t.count(), t.name).toBe(0)
    expect((await d.tickets.toArray()).map(t => [t.id, t.status, t.xp])).toEqual([['a', 'done', 10]])
    expect(await d.journal.count()).toBe(1)
    expect((await d.settings.get('main'))?.startDate).toBe('2026-09-07')
    expect(await d._outbox.count()).toBe(0)
    d.close()
  })

  it('a lab row, a run and a review round-trip', async () => {
    const d = createDb(dbName())
    await d.open()
    await d.labs.put({ labId: 't-lab', repo: 'r', path: 'labs/t-lab', root: '~/labs', baseCommit: 'a'.repeat(40), version: 1, setupAt: 1, hints: [] })
    await d.labRuns.put({ id: 'run-t-lab-2', labId: 't-lab', at: 2, ms: 5, exit: null, timedOut: true, results: null, tail: '' })
    await d.labReviews.put({ id: 'rev-t-lab-3', labId: 't-lab', at: 3, items: [], percent: 0, passed: false, summary: '' })
    expect((await d.labRuns.where('labId').equals('t-lab').toArray())[0].exit).toBeNull()
    expect((await d.labReviews.orderBy('at').last())?.id).toBe('rev-t-lab-3')
    d.close()
  })
})

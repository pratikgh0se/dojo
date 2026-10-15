import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, getSettings, patchSettings, SCHEMA_V10 } from '../../src/data/db'
import { freshDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'

describe('Dexie schema', () => {
  it('opens every v2 table: the four core tables plus the eleven foundation tables', async () => {
    const d = freshDb()
    await d.open()
    expect(d.tables.map(t => t.name).sort()).toEqual(Object.keys(SCHEMA_V10).sort())
    expect(d.tables).toHaveLength(24) // 22 app tables (pulses is the v8 one, journal the v9 one, bankGrades and bankExtra the v10 ones) + the v3 sync tables _outbox and _meta
  })
  it('returns default settings before any write', async () => {
    const d = freshDb()
    expect(await getSettings(d)).toEqual(DEFAULT_SETTINGS)
  })
  it('patches and persists the single settings row', async () => {
    const d = freshDb()
    await patchSettings(d, { planVersion: 'v1' })
    await patchSettings(d, { startDate: '' })
    expect(await getSettings(d)).toMatchObject({ id: 'main', planVersion: 'v1', startDate: '' })
    expect(await d.settings.count()).toBe(1)
  })
  it('indexes tickets by sprint and events by auto-increment seq', async () => {
    const d = freshDb()
    await d.tickets.bulkPut([mkTicket({ id: 'a', sprint: 2 }), mkTicket({ id: 'b', sprint: 3 })])
    expect((await d.tickets.where('sprint').equals(2).toArray()).map(t => t.id)).toEqual(['a'])
    const s1 = await d.events.add({ t: 'untick', id: 'a', at: 1 })
    const s2 = await d.events.add({ t: 'untick', id: 'b', at: 2 })
    expect(s2).toBeGreaterThan(s1)
  })
})

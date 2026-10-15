import { describe, expect, it } from 'vitest'
import { getSettings, patchSettings } from '../../src/data/db'
import { recordFormUp, shownForm } from '../../src/data/pomActions'
import { freshDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'

async function dbWithXp(xp: number) {
  const d = freshDb()
  await d.tickets.put(mkTicket({ id: 'a', status: 'done', xp }))
  return d
}

/** An XP-granting action: the form shown before it, then the XP it adds, then the call the reward layer makes. */
async function doneAdding(d: ReturnType<typeof freshDb>, add: number) {
  const before = await shownForm(d)
  await d.tickets.put(mkTicket({ id: 'quest', status: 'done', xp: add }))
  return recordFormUp(d, before)
}

describe('TODAY-54: a celebration needs the SHOWN form to change', () => {
  it('FX-IDLE-like (xp 320, nothing stored): a Done of 20 XP writes pomFormMax 1 and celebrates nothing', async () => {
    const d = await dbWithXp(320)
    expect(await shownForm(d)).toBe(1)
    expect(await doneAdding(d, 20)).toBeNull()
    expect((await getSettings(d)).pomFormMax).toBe(1)
  })
  it('a Done crossing LV 40 (395 to 415 XP) celebrates SURGE', async () => {
    const d = await dbWithXp(395)
    expect(await doneAdding(d, 20)).toEqual({ from: 1, to: 2 })
    expect((await getSettings(d)).pomFormMax).toBe(2)
  })
  it('on a stored max of 8 nothing celebrates and nothing is written', async () => {
    const d = await dbWithXp(395)
    await patchSettings(d, { pomFormMax: 8 })
    const row = await d.settings.get('main')
    expect(await doneAdding(d, 20)).toBeNull()
    expect(await d.settings.get('main')).toEqual(row)
  })
  it('a second action in the same form celebrates nothing', async () => {
    const d = await dbWithXp(320)
    await doneAdding(d, 20)
    expect(await recordFormUp(d, await shownForm(d))).toBeNull()
  })
})

describe('recordFormUp: pomFormMax is written only when an action pushed the computed form past it', () => {
  it('writes the new form and reports the step', async () => {
    const d = await dbWithXp(100) // LV 10 = KINDLE
    expect(await recordFormUp(d, 0)).toEqual({ from: 0, to: 1 })
    expect((await getSettings(d)).pomFormMax).toBe(1)
  })
  it('a second call with nothing new writes nothing and reports nothing (the celebration plays once)', async () => {
    const d = await dbWithXp(100)
    await recordFormUp(d, 0)
    const ops = await d.settings.get('main')
    expect(await recordFormUp(d, await shownForm(d))).toBeNull()
    expect(await d.settings.get('main')).toEqual(ops)
  })
  it('with LV forced lower the stored form stays and nothing is written', async () => {
    const d = await dbWithXp(100)
    await recordFormUp(d, 0)
    await d.tickets.put(mkTicket({ id: 'a', status: 'done', xp: 20 }))
    expect(await recordFormUp(d, await shownForm(d))).toBeNull()
    expect((await getSettings(d)).pomFormMax).toBe(1)
  })
  it('at BASE with nothing stored it creates no settings row', async () => {
    const d = await dbWithXp(50)
    expect(await recordFormUp(d, 0)).toBeNull()
    expect(await d.settings.get('main')).toBeUndefined()
  })
  it('a jump over several forms stores the highest one reached', async () => {
    const d = await dbWithXp(1000)
    expect(await recordFormUp(d, 0)).toEqual({ from: 0, to: 3 })
    expect((await getSettings(d)).pomFormMax).toBe(3)
  })
  it('merged-away tickets do not count (the header XP rule)', async () => {
    const d = freshDb()
    await d.tickets.bulkPut([mkTicket({ id: 'a', status: 'done', xp: 60 }), mkTicket({ id: 'b', status: 'done', xp: 60, mergedInto: 'a' })])
    expect(await recordFormUp(d, 0)).toBeNull()
  })
})

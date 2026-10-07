import { afterEach, describe, expect, it } from 'vitest'
import { getSettings } from '../../src/data/db'
import { saveStartDate } from '../../src/data/settingsActions'
import { resetNow, setNow } from '../../src/lib/clock'
import { freshDb } from '../helpers/db'

afterEach(() => resetNow())

describe('saveStartDate records where tracking began', () => {
  it('trackedFrom is the sprint of the moment the start date is saved, and is reset when it changes', async () => {
    const d = freshDb()
    setNow(() => new Date(2026, 9, 20, 10).getTime()) // 2026-10-20
    expect(await saveStartDate(d, '2026-10-05', () => {})).toBe(true)
    expect(await getSettings(d)).toMatchObject({ startDate: '2026-10-05', trackedFrom: 2 })
    expect(await saveStartDate(d, '2026-10-19', () => {})).toBe(true)
    expect(await getSettings(d)).toMatchObject({ startDate: '2026-10-19', trackedFrom: 1 })
    setNow(() => new Date(2026, 9, 1).getTime()) // before the plan starts: sprint 1
    await saveStartDate(d, '2026-10-05', () => {})
    expect((await getSettings(d)).trackedFrom).toBe(1)
  })
  it('an invalid date changes nothing', async () => {
    const d = freshDb()
    let msg = ''
    expect(await saveStartDate(d, 'nope', m => { msg = m })).toBe(false)
    expect(msg).toContain('valid date')
    expect((await getSettings(d)).trackedFrom).toBeUndefined()
  })
})

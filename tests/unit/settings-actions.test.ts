import { afterEach, describe, expect, it } from 'vitest'
import { getSettings } from '../../src/data/db'
import { saveCareerLane, saveLaneBudgets, saveNavLabels, saveSessionMinutes, saveStartDate } from '../../src/data/settingsActions'
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

describe('pace and navigation settings (SET-05, SET-06, SET-08)', () => {
  it('saves valid budgets and refuses bad ones without touching the stored value', async () => {
    const d = freshDb()
    expect(await saveLaneBudgets(d, [90, 60, 120, 60, 30, 30, 150])).toEqual({ ok: true })
    expect((await getSettings(d)).laneBudgets).toEqual([90, 60, 120, 60, 30, 30, 150])
    for (const bad of [[1, 2], [-1, 0, 0, 0, 0, 0, 0], [601, 0, 0, 0, 0, 0, 0], [1.5, 0, 0, 0, 0, 0, 0]]) {
      expect(await saveLaneBudgets(d, bad)).toMatchObject({ ok: false, message: expect.stringContaining('0 to 600') })
    }
    expect((await getSettings(d)).laneBudgets).toEqual([90, 60, 120, 60, 30, 30, 150])
  })
  it('saves the career switch, the session length and the label mode', async () => {
    const d = freshDb()
    await saveCareerLane(d, true)
    await saveSessionMinutes(d, 40)
    await saveNavLabels(d, 'always')
    expect(await getSettings(d)).toMatchObject({ careerLane: true, sessionMinutes: 40, navLabels: 'always' })
    expect(await saveSessionMinutes(d, 3)).toMatchObject({ ok: false })
    expect(await saveNavLabels(d, 'nope' as never)).toMatchObject({ ok: false })
  })
})

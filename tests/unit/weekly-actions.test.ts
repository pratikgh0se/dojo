import { describe, expect, it } from 'vitest'
import { saveWeeklyReview } from '../../src/data/weeklyActions'
import { freshDb } from '../helpers/db'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const NOW = at(2026, 11, 8, 14) // Sunday afternoon, week 2026-W45
const F = { worked: '  Finished the lab outline  ', change: '', focus: 'Roofline function and its test' }

describe('saveWeeklyReview', () => {
  it('writes wr-<week> with trimmed strings and nothing else', async () => {
    const d = freshDb()
    const row = await saveWeeklyReview(d, F, '2026-W45', NOW)
    expect(row).toEqual({ id: 'wr-2026-W45', week: '2026-W45', worked: 'Finished the lab outline', change: '', focus: 'Roofline function and its test', at: NOW })
    expect(await d.weeklyReviews.toArray()).toEqual([row])
    for (const t of ['tickets', 'sessions', 'redos', 'journal', 'events'] as const) expect(await d.table(t).count(), t).toBe(0)
  })
  it('a second save of the same week replaces the first (same id, new time)', async () => {
    const d = freshDb()
    await saveWeeklyReview(d, F, '2026-W45', NOW)
    await saveWeeklyReview(d, { ...F, change: 'Start earlier in the day', focus: 'Finish the roofline test' }, '2026-W45', NOW + 60_000)
    const rows = await d.weeklyReviews.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ worked: 'Finished the lab outline', change: 'Start earlier in the day', focus: 'Finish the roofline test', at: NOW + 60_000 })
  })
  it('a past week keeps its own row beside the current one', async () => {
    const d = freshDb()
    await saveWeeklyReview(d, F, '2026-W44', NOW)
    await saveWeeklyReview(d, F, '2026-W45', NOW)
    expect((await d.weeklyReviews.toArray()).map(r => r.id).sort()).toEqual(['wr-2026-W44', 'wr-2026-W45'])
  })
  it('an all-blank form writes nothing for a new week, but clears a stored review (a cleared field is a change)', async () => {
    const d = freshDb()
    const blank = { worked: ' ', change: '', focus: '' }
    expect(await saveWeeklyReview(d, blank, '2026-W45', NOW)).toBeNull()
    expect(await d.weeklyReviews.count()).toBe(0)
    await saveWeeklyReview(d, F, '2026-W45', NOW)
    expect(await saveWeeklyReview(d, blank, '2026-W45', NOW + 1)).toMatchObject({ worked: '', change: '', focus: '' })
    expect(await d.weeklyReviews.count()).toBe(1)
  })
  it('writes nothing for a future week or an invalid key', async () => {
    const d = freshDb()
    expect(await saveWeeklyReview(d, F, '2026-W46', NOW)).toBeNull()
    expect(await saveWeeklyReview(d, F, '2026-W54', NOW)).toBeNull()
    expect(await d.weeklyReviews.count()).toBe(0)
  })
})

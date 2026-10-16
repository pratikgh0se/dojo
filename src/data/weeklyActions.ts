import { isoWeekOf } from '../rules/ritual'
import { weekStart, weeklyBlank, weeklyId, weeklyRow, type WeeklyForm } from '../rules/weekly'
import type { DojoDB } from './db'
import type { WeeklyReviewRow } from './types'

/**
 * Save the weekly review for an ISO week (one row per week, replaced whole by every save; a second save is an edit).
 * Writes only `weeklyReviews`. A future or invalid week writes nothing; an all-blank form writes nothing for a week with no row yet
 * (it can still clear a stored review). Called only from the Save click.
 */
export async function saveWeeklyReview(d: DojoDB, form: WeeklyForm, week: string, nowMs: number): Promise<WeeklyReviewRow | null> {
  if (weekStart(week) === null || week > isoWeekOf(nowMs).key) return null
  return d.transaction('rw', d.weeklyReviews, async () => {
    if (weeklyBlank(form) && !(await d.weeklyReviews.get(weeklyId(week)))) return null
    const row = weeklyRow(form, week, nowMs)
    await d.weeklyReviews.put(row)
    return row
  })
}

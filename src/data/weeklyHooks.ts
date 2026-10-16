import { useLiveQuery } from 'dexie-react-hooks'
import { latestFocus } from '../rules/weekly'
import { useDb } from './dbContext'
import type { WeeklyReviewRow } from './types'

export function useWeeklyReviews(): WeeklyReviewRow[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.weeklyReviews.toArray(), [d])
}

/** Today's focus line; undefined while loading, '' when there is none. */
export function useLatestFocus(): string | undefined {
  const rows = useWeeklyReviews()
  return rows ? latestFocus(rows) : undefined
}

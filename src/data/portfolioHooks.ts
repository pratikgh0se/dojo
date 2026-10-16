import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from './dbContext'

/** Everything the Portfolio screen shows, in one live query (a handful of small rows). Undefined while loading. */
export function usePortfolioData() {
  const d = useDb()
  return useLiveQuery(async () => ({
    items: await d.portfolioItems.toArray(),
    labs: await d.labs.toArray(),
    reviews: await d.labReviews.toArray(),
  }), [d])
}

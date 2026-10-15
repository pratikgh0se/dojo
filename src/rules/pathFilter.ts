import type { LaneFilter } from './queue'

export interface PathFilter { lane: LaneFilter; query: string }
export const PATH_FILTER_KEY = 'dojo.path.filter'
const LANES: readonly LaneFilter[] = ['all', 'path', 'dsa', 'design', 'career']
const DEFAULT: PathFilter = { lane: 'all', query: '' }

const store = (): Storage | null => {
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage } catch { return null }
}

/** NAV-40: the lane and the search text, kept for this browser tab only (sessionStorage), so Back finds Path as it was left. */
export function loadPathFilter(s: Storage | null = store()): PathFilter {
  try {
    const raw = s?.getItem(PATH_FILTER_KEY)
    if (!raw) return { ...DEFAULT }
    const v = JSON.parse(raw) as Partial<PathFilter> | null
    const lane = LANES.find(l => l === v?.lane)
    return { lane: lane ?? 'all', query: typeof v?.query === 'string' ? v.query : '' }
  } catch { return { ...DEFAULT } }
}

/** The default state (All lane, empty search) stores nothing: clearing forgets it (NAV-41). */
export function savePathFilter(f: PathFilter, s: Storage | null = store()): void {
  try {
    if (f.lane === 'all' && f.query === '') s?.removeItem(PATH_FILTER_KEY)
    else s?.setItem(PATH_FILTER_KEY, JSON.stringify(f))
  } catch { /* storage blocked: the filter simply is not remembered */ }
}

export function clearPathFilter(s: Storage | null = store()): void {
  try { s?.removeItem(PATH_FILTER_KEY) } catch { /* nothing to forget */ }
}

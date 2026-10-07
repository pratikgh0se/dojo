import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useDb } from './dbContext'
import { useSettings } from './hooks'
import { now } from '../lib/clock'
import { useNow } from '../lib/useNow'
import { isReadOnly } from './writer'
import { whenDiskSettled } from './diskSettled'

/**
 * Automatic roll-over (briefs spec §3): whenever the app opens, changes screen or a minute passes, cards
 * left in an ended sprint move on to the current one. Only the writer does it; the action is idempotent.
 */
export function useRollover(): void {
  const d = useDb()
  const start = useSettings()?.startDate
  const tick = useNow(60_000)
  const { pathname } = useLocation()
  useEffect(() => {
    if (!start || isReadOnly()) return
    // loaded on demand: the roll-over action stays out of the entry chunk
    // after the first disk sync, so the disk's state can't overwrite the roll-over (ruling 9 renders before it)
    whenDiskSettled()
      .then(() => import('./workloadActions'))
      .then(m => m.runRollover(d, now()))
      .catch(() => { /* a failed write is retried at the next tick */ })
  }, [d, start, tick, pathname])
}

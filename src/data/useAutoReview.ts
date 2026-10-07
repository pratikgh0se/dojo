import { useEffect, useRef } from 'react'
import { whenDiskSettled } from './diskSettled'
import { useLocation } from 'react-router-dom'
import { syncGate } from './db'
import { useDb } from './dbContext'
import { useSettings } from './hooks'
import { isReadOnly } from './writer'
import { now } from '../lib/clock'
import { useNow } from '../lib/useNow'

/** The session budget, per database: at most AUTO_REVIEWS_PER_OPEN automatic reviews per app open, however often the effect re-runs. */
const spent = new Map<string, number>()
/** Sprints already attempted in this session: a failed attempt is not retried until the app is opened again. */
const attempted = new Set<string>()
export const resetAutoReviewMemory = (): void => { spent.clear(); attempted.clear() }

/** Runs `fn` while holding the app-wide lock, or does nothing when another tab holds it. Without Web Locks it just runs. */
async function exclusively(fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return fn()
  await locks.request('dojo-auto-review', { ifAvailable: true }, async lock => { if (lock) await fn() })
}

/**
 * Briefs Addendum 3: when a sprint has ended without an automatic review, build it on the next app open (the
 * numbers at once, the prose from `review_sprint`): newest first, at most 3 per app open (a session budget, not per run). Writer only, one tab at
 * a time, and never twice for a sprint in one session. Cards are rolled over first so the review sees the slips.
 */
export function useAutoReview(): void {
  const d = useDb()
  const start = useSettings()?.startDate
  const tick = useNow(60_000)
  const { pathname } = useLocation()
  const busy = useRef(false)
  useEffect(() => {
    if (!start || syncGate.readOnly || isReadOnly() || busy.current) return
    busy.current = true
    void exclusively(async () => {
      await whenDiskSettled() // see diskSettled.ts
      const at = now()
      // loaded on demand: the review code stays out of the entry chunk
      const [{ runRollover }, { AUTO_REVIEWS_PER_OPEN, buildReview, sprintsNeedingReview }] = await Promise.all([import('./workloadActions'), import('./reviewActions')])
      await runRollover(d, at)
      const left = AUTO_REVIEWS_PER_OPEN - (spent.get(d.name) ?? 0)
      if (left <= 0) return
      const tried = new Set([...attempted].filter(k => k.startsWith(`${d.name}:`)).map(k => Number(k.slice(d.name.length + 1))))
      for (const sprint of await sprintsNeedingReview(d, at, tried, left)) {
        attempted.add(`${d.name}:${sprint}`)
        spent.set(d.name, (spent.get(d.name) ?? 0) + 1)
        await buildReview(d, sprint, at, true)
      }
    }).catch(() => { /* not retried before the next app open */ }).finally(() => { busy.current = false })
  }, [d, start, tick, pathname])
}

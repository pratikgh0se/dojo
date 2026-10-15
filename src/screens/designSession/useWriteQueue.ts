import { useCallback, useRef, useState } from 'react'
import { safeWrite } from '../../data/safeWrite'
import { now } from '../../lib/clock'

type Job = () => Promise<unknown>
type Entry = { key?: string; job: Job; started: boolean }

/** Serialises IndexedDB writes so a later change never lands before an earlier one; `flush` waits for all.
 * `savedAt` is when the last write landed without an error (null before the first one).
 *
 * A job pushed with a `key` is a whole-snapshot write (the notes, the canvas): while an earlier job with the same key is
 * still waiting its turn, the newer one replaces it (latest wins), so a burst of keystrokes costs at most one running
 * and one pending transaction per key, never one per keystroke. Nothing is debounced: the pending job is always the
 * newest snapshot and starts as soon as the one before it ends.
 *
 * `flushNow` is for a page that is going away (pagehide, hidden tab): a promise chain cannot continue after unload, so
 * it starts the newest snapshot of every key at once, without waiting behind the chain, so its IndexedDB request is
 * issued while the page can still do it. IndexedDB runs overlapping read-write transactions in creation order, so the
 * forced write still lands after anything already running. It cannot make a read-modify-write finish once the page is
 * torn down (the read's callback never runs): the screen also stashes the newest snapshot synchronously (designPending)
 * for the next load to apply. */
export function useWriteQueue(onError: (m: string) => void): {
  push: (job: Job, key?: string) => void; flush: () => Promise<void>; flushNow: () => void; savedAt: number | null
} {
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const queued = useRef<Entry[]>([])
  /** the newest entry of each key that has not finished yet (queued or running) */
  const newest = useRef(new Map<string, Entry>())
  const forced = useRef(new Set<Promise<unknown>>())
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const run = useCallback(async (e: Entry) => {
    let failed = false
    try {
      const r = await safeWrite(e.job, m => { failed = true; onError(m) })
      // `false` is a guarded write that did nothing (the phase had moved on): nothing was saved, so nothing is stamped.
      if (!failed && r !== false) setSavedAt(now())
    } catch {
      onError('Could not save the session')
    } finally {
      if (e.key && newest.current.get(e.key) === e) newest.current.delete(e.key)
    }
  }, [onError])

  const push = useCallback((job: Job, key?: string) => {
    if (key) {
      const waiting = queued.current.find(e => e.key === key && !e.started)
      if (waiting) { waiting.job = job; return }
    }
    const e: Entry = { key, job, started: false }
    queued.current.push(e)
    if (key) newest.current.set(key, e)
    chain.current = chain.current.then(async () => {
      const next = queued.current.shift()
      if (!next || next.started) return
      next.started = true
      await run(next)
    })
  }, [run])

  const flush = useCallback(async () => {
    await chain.current
    await Promise.allSettled([...forced.current])
  }, [])

  const flushNow = useCallback(() => {
    for (const e of newest.current.values()) {
      e.started = true
      const p = run(e)
      forced.current.add(p)
      void p.finally(() => forced.current.delete(p))
    }
  }, [run])

  return { push, flush, flushNow, savedAt }
}

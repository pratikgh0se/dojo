import { useCallback, useEffect, useState } from 'react'
import { useDb } from '../app/providers'
import { startDoing } from '../data/sessionActions'
import { safeWrite } from '../data/safeWrite'
import { playChime, primeChime } from '../lib/chime'
import { now } from '../lib/clock'
import { bankRun, loadCycle, saveCycle } from '../lib/cycle'
import { loadChimePref, loadStudy, subscribeStudy } from '../lib/studyStore'
import {
  blockingTimerTicketId, clearTimer, clockLabel, drainBlocks, isPaused, loadTimer, pauseTimer, resumeTimer, saveTimer, startTimer, timerView,
  type DrainBlock, type TimerState,
} from '../lib/timer'
import { useNow } from '../lib/useNow'
import { useFlash, usePowerUp, useToast } from './primitives'

export interface SparTimer {
  running: boolean
  /** Ruling 23 K1: space pauses the block; paused, the readout holds and space resumes it */
  paused: boolean
  mmss: string
  blocks: DrainBlock[]
  min: number
  endsAt: string
  start: (min: number) => void
  retreat: () => void
  /** space on Today: pause a running block, resume a paused one, else start Spar · 25 */
  toggle: () => void
}

/** The NOW tile's Spar · 50 / Spar · 25 timer. Shares the single `dojo-timer` with the Do screen. */
export function useSparTimer(primaryId: string | null): SparTimer {
  const d = useDb()
  const t = useNow(1000)
  const toast = useToast()
  const flash = useFlash()
  const { fire: powerUp } = usePowerUp()
  const [timer, setTimer] = useState<TimerState | null>(() => loadTimer())
  const view = timerView(timer, t)

  // ruling 24 S1: a study session (and its End) moves the shared timer under this hook; follow the stored one
  useEffect(() => subscribeStudy(() => setTimer(loadTimer())), [])

  useEffect(() => {
    // Stop, don't clear: leaving running:false/notified:true with sessionStart kept lets a
    // same-day Do finish on this ticket pick up the Spar minutes (N2). startTimer's same-day
    // guard (N1) keeps a later day from inheriting this stale sessionStart.
    // a study session's own block timer is the session's to end (its runner chimes and moves to the break)
    if (timer && timer.running && view.expired && !timer.notified && loadStudy()?.ticketId !== timer.ticketId) {
      flash()
      powerUp()
      if (loadChimePref()) playChime() // a run that ends unseen is still heard
      toast(`Power up · ${timer.min} min`)
      const n = { ...timer, running: false, notified: true }
      saveTimer(n)
      setTimer(n)
    }
  }, [timer, view.expired, flash, powerUp, toast])

  const start = useCallback(
    async (min: number) => {
      if (!primaryId) return
      if (loadChimePref()) primeChime() // inside the click: the autoplay policy lets the end-of-run chime sound later
      const current = loadTimer()
      const blocker = blockingTimerTicketId(current, primaryId)
      if (blocker) {
        // a running study session is ended from its pill or its card, a Spar timer is retreated
        const bySession = loadStudy()?.ticketId === blocker
        toast(bySession ? 'A study session is running on another card — end it first' : 'A timer is already running on another ticket — Retreat first', 'danger')
        return
      }
      // Await startDoing before starting the timer (N3), the same error path Do.tsx's start()
      // uses: a failed move (e.g. Doing full) must not leave a running timer behind. Sample
      // `now()` once, before the await, so the session's start time is the click time, not
      // whatever time has passed once the write resolves.
      const at = now()
      const r = await safeWrite(() => startDoing(d, primaryId, at), m => toast(m, 'danger'))
      if (!r) return
      if (!r.ok) {
        toast(r.message, 'danger')
        return
      }
      const next = startTimer(current, primaryId, min, at)
      saveTimer(next)
      setTimer(next)
    },
    [d, primaryId, toast],
  )

  const retreat = useCallback(() => {
    if (!timer) return
    // Clear rather than just stop: a stopped-but-stored timer keeps its sessionStart around for
    // the same ticket, which lib/timer.ts's startTimer would reuse on the next Start (I1).
    clearTimer()
    setTimer(null)
  }, [timer])

  /** Pause keeps what is left of the block; the minutes so far are banked into this card's attempt, as on Do. */
  const pause = useCallback(() => {
    const cur = loadTimer()
    if (!cur) return
    const cycle = loadCycle(cur.ticketId)
    if (cycle) saveCycle(bankRun(cycle, cur, now()))
    const n = pauseTimer(cur, now())
    saveTimer(n)
    setTimer(n)
  }, [])
  const resume = useCallback(() => {
    const cur = loadTimer()
    if (!cur) return
    const n = resumeTimer(cur, now())
    saveTimer(n)
    setTimer(n)
  }, [])
  const toggle = useCallback(() => {
    const cur = loadTimer()
    const v = timerView(cur, now())
    if (cur && v.running && !v.expired) pause()
    else if (isPaused(cur)) resume()
    else void start(25)
  }, [pause, resume, start])

  const paused = view.paused
  const running = view.running && !view.expired && !paused
  const total = timer ? timer.totalMs ?? timer.end - timer.start : 0
  return {
    running,
    paused,
    mmss: view.mmss,
    blocks: (running || paused) && timer ? drainBlocks(view.remainingMs, total) : [],
    min: timer?.min ?? 0,
    endsAt: timer ? clockLabel(timer.end) : '',
    start,
    retreat,
    toggle,
  }
}

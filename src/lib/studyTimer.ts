import type { Study, Advanced } from '../rules/studySession'
import { phaseEnd, remainingMs } from '../rules/studySession'
import { bankRun, type Cycle } from './cycle'
import { pad2 } from './dates'
import type { TimerState } from './timer'

/**
 * The legacy Do timer (`dojo-timer`) mirrors the session's focus block, so the attempt cycle banks the
 * same minutes and the help ladder unlocks on them (C-LADDER §2.2). One block = one timer window.
 */
export function blockTimer(s: Study, start: number, end: number, running: boolean): TimerState {
  return { ticketId: s.ticketId, sessionStart: s.startedAt, start, end, min: Math.round((end - start) / 60_000), running, notified: !running }
}

export interface Applied { cycle: Cycle | null; timer: TimerState | null }

/**
 * After `advance`: bank every finished focus block into the cycle (idempotent, keyed by the block's
 * start) and return the legacy timer for the new phase: running for a focus block, stopped and
 * notified for a break. `timer` is null when nothing switched, so the caller keeps its own.
 */
export function applyAdvance(cycle: Cycle | null, before: Study, r: Advanced, now: number): Applied {
  if (!r.switched) return { cycle, timer: null }
  let c = cycle
  if (c) for (const b of r.finished) c = bankRun(c, blockTimer(before, b.start, b.end, false), now)
  const s = r.study
  const last = r.finished[r.finished.length - 1]
  const timer = s.phase === 'focus'
    ? blockTimer(s, s.phaseStart, phaseEnd(s), true)
    : blockTimer(s, last ? last.start : s.phaseStart, last ? last.end : s.phaseStart, false)
  return { cycle: c, timer }
}

/** mm:ss left in the current phase. */
export function sessionLabel(s: Study, now: number): string {
  const secs = Math.ceil(remainingMs(s, now) / 1000)
  return `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`
}

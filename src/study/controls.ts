// The study session's small controls (pause, resume, resume after a gap, "end it now"), kept apart from runner.ts so the
// Shell's session pill and Today's NOW tile can use them without pulling the runner's data layer into the entry chunk.
import { updateStudy, notifyStudy } from '../lib/studyStore'
import { blockTimer } from '../lib/studyTimer'
import { saveTimer } from '../lib/timer'
import { pauseStudy, phaseEnd, resumePausedStudy, resumeStudy } from '../rules/studySession'

/**
 * UAT J3 (D3.5): Pause the study session. A focus block's legacy timer stops at now and counts its minutes so far
 * (stopped and notified); Resume replaces it with the rest of the block, started where the shifted phase starts,
 * so the block is banked once, whole, when it ends.
 */
export function pauseSession(nowMs: number): void {
  const s = updateStudy(cur => pauseStudy(cur, nowMs))
  if (!s || s.paused == null) return
  if (s.phase === 'focus') saveTimer(blockTimer(s, s.phaseStart, nowMs, false))
  notifyStudy()
}
export function resumeSession(nowMs: number): void {
  const s = updateStudy(cur => resumePausedStudy(cur, nowMs))
  if (!s || s.paused != null) return
  if (s.phase === 'focus') saveTimer(blockTimer(s, s.phaseStart, phaseEnd(s), true))
  notifyStudy()
}

/** "Resume" from the Welcome back dialog: the current phase restarts from now, with its timer. */
export function resumeAfterAway(nowMs: number): void {
  const s = updateStudy(cur => (cur.away ? resumeStudy(cur, nowMs) : cur))
  if (!s) return
  saveTimer(blockTimer(s, s.phaseStart, phaseEnd(s), s.phase === 'focus'))
  notifyStudy()
}

// Ruling 24 S1: a running session can be ended from any screen (the NOW tile's End). The End session dialog and the
// write live in the runner chunk, which is mounted whenever a session exists; this is the one-way request to it.
const END_EVENT = 'dojo-study-end-request'
export function requestEndSession(): void {
  try {
    window.dispatchEvent(new Event(END_EVENT))
  } catch {
    // no window: nothing to ask
  }
}
export function onEndRequest(cb: () => void): () => void {
  window.addEventListener(END_EVENT, cb)
  return () => window.removeEventListener(END_EVENT, cb)
}

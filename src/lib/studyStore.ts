import { isStudy, type Study } from '../rules/studySession'
import { readJson, removeKey, writeJson, type StorageLike } from './storage'
import { isPaused, loadTimer } from './timer'

export const STUDY_KEY = 'dojo-study'
export const CHIME_KEY = 'dojo-study-chime'
const EVENT = 'dojo-study-changed'
const CHANNEL = 'dojo-study'

export function loadStudy(s?: StorageLike): Study | null {
  return readJson(STUDY_KEY, s, isStudy)
}
export function saveStudy(v: Study, s?: StorageLike): void {
  writeJson(STUDY_KEY, v, s)
}
export function clearStudy(s?: StorageLike): void {
  removeKey(STUDY_KEY, s)
}

let channel: BroadcastChannel | null | undefined
function chan(): BroadcastChannel | null {
  if (channel === undefined) {
    try {
      channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL)
    } catch {
      channel = null
    }
  }
  return channel
}

/** Tell this tab (custom event) and every other tab (BroadcastChannel; `storage` events cover the rest). */
export function notifyStudy(): void {
  try {
    window.dispatchEvent(new Event(EVENT))
    chan()?.postMessage('changed')
  } catch {
    // no window: nothing to tell
  }
}

/** Runs `cb` whenever the session, its timer or its cycle may have changed, in this tab or another. */
export function subscribeStudy(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === STUDY_KEY || e.key === 'dojo-timer' || e.key.startsWith('dojo-cycle:')) cb()
  }
  window.addEventListener(EVENT, cb)
  window.addEventListener('storage', onStorage)
  const c = chan()
  c?.addEventListener('message', cb)
  return () => {
    window.removeEventListener(EVENT, cb)
    window.removeEventListener('storage', onStorage)
    c?.removeEventListener('message', cb)
  }
}

/**
 * Change the stored session from its FRESH stored value, never from a copy a tab has been holding:
 * a stale tab finds the session gone (ended elsewhere) and its write is dropped, so it cannot bring
 * an ended session back. `fn` returns the next state, or null to end it. Returns the stored result,
 * or undefined when there was no session.
 */
export function updateStudy(fn: (cur: Study) => Study | null, s?: StorageLike): Study | null | undefined {
  const cur = loadStudy(s)
  if (!cur) return undefined
  const next = fn(cur)
  if (next === cur) return cur
  if (next) saveStudy(next, s)
  else clearStudy(s)
  notifyStudy()
  return next
}

/** The soft chime is on unless he turned it off. */
export function loadChimePref(s?: StorageLike): boolean {
  return readJson(CHIME_KEY, s, (v): v is boolean => typeof v === 'boolean') ?? true
}
export function saveChimePref(on: boolean, s?: StorageLike): void {
  writeJson(CHIME_KEY, on, s)
}

/** The cards being worked on right now: the running study session's card, and the card of a running or paused timer. */
export function activeTicketIds(s?: StorageLike): Set<string> {
  const out = new Set<string>()
  const study = loadStudy(s)
  if (study) out.add(study.ticketId)
  const timer = loadTimer(s)
  if (timer && (timer.running || isPaused(timer))) out.add(timer.ticketId)
  return out
}

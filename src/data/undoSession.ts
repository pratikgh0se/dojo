// Ruling 20 S6: the Undo history belongs to one app session. Every undoable event is stamped with the session that
// wrote it, and Undo only offers this session's events, so a relaunch starts with an empty history.
import type { StoredEvent } from './types'

function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** This app session (one page load: one launch of the desktop app). */
export const APP_SESSION: string = newSessionId()

/** The event as written by this session (undoable in it, and only in it). */
export function stamp<E extends StoredEvent>(e: E): E {
  return { ...e, appSession: APP_SESSION }
}

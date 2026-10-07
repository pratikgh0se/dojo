import type { EndLog } from '../data/types'

/**
 * UAT cu-2 P3-8: what was typed in the End session dialog survives "Keep going" (the dialog closes, the session runs on)
 * and comes back when it is reopened. Kept in memory per session; a saved or otherwise ended session drops it.
 */
const drafts = new Map<string, EndLog>()
const EMPTY: EndLog = { done: '', stuckOn: '', nextStep: '' }

export function loadEndDraft(sessionId: string): EndLog {
  return drafts.get(sessionId) ?? EMPTY
}
export function saveEndDraft(sessionId: string, log: EndLog): void {
  if (!log.done && !log.stuckOn && !log.nextStep) drafts.delete(sessionId)
  else drafts.set(sessionId, log)
}
export function dropEndDraft(sessionId: string): void {
  drafts.delete(sessionId)
}

import { getSaveState, setSaveState, syncControls } from './sync/status'
import { isReadOnlyError, READ_ONLY_MESSAGE } from './writer'
import { copy } from '../lib/platform'

export const QUOTA_MESSAGE = copy('quotaFull')

export function isQuotaError(e: unknown): boolean {
  let cur: unknown = e
  for (let i = 0; i < 4 && cur && typeof cur === 'object'; i++) {
    if ((cur as { name?: unknown }).name === 'QuotaExceededError') return true
    cur = (cur as { inner?: unknown }).inner
  }
  return false
}

/** Writes started via `safeWrite` that have not yet settled (§4.3/§4.4: an in-app link navigating right
 * after one of these — e.g. DSA warm-up's "Open in Atlas", S39 — must await it first, not race it). */
const pending = new Set<Promise<unknown>>()

export async function safeWrite<T>(fn: () => Promise<T>, onError: (msg: string) => void): Promise<T | undefined> {
  // "Saved" must never show while a write is on its way: say "Saving…" from the click, and once the
  // write has settled let the sync loop decide (it says "Saved" again when nothing is left to send).
  const marked = getSaveState() === 'saved'
  if (marked) setSaveState('saving')
  const p = (async () => {
    try {
      return await fn()
    } catch (e) {
      if (isQuotaError(e)) {
        onError(QUOTA_MESSAGE)
        return undefined
      }
      if (isReadOnlyError(e)) {
        onError(READ_ONLY_MESSAGE) // Addendum 4 Q1: the refusal is a visible toast
        return undefined
      }
      throw e
    }
  })()
  pending.add(p)
  p.finally(() => {
    pending.delete(p)
    if (marked && getSaveState() === 'saving') void syncControls.flush().catch(() => {})
  }).catch(() => {})
  return p
}

/** Resolves once every `safeWrite` started so far has settled. Call before navigating away from a screen
 * that just triggered a write whose result the destination screen reads (e.g. Atlas's per-row state). */
export async function waitForPendingWrites(): Promise<void> {
  await Promise.allSettled([...pending])
}

import type { Session } from '../data/types'

/**
 * Ruling 24 S3 (cu-2 P2-6): a session row says what each number is. "15 min session" is the clock time from its start to
 * its end (the actual length of the session, breaks and pauses included); "4 min focus" is the finished focus blocks in it,
 * the same minutes Today, Week and Progress count. A row from before sessions kept their focus minutes shows the length only.
 */
export function sessionLengthText(s: Pick<Session, 'minutes' | 'focusMinutes'>): string {
  const len = `${s.minutes} min session`
  return typeof s.focusMinutes === 'number' ? `${len} · ${s.focusMinutes} min focus` : len
}

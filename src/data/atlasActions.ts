import type { DojoDB } from './db'

/** A walkthrough was watched to its last step (not via Last step, D-7). One row per key is enough. */
export async function recordSeen(d: DojoDB, key: string, at: number): Promise<void> {
  await d.transaction('rw', d.atlasRuns, async () => {
    const already = await d.atlasRuns.where('key').equals(key).filter(r => r.kind === 'seen').count()
    if (already === 0) await d.atlasRuns.add({ key, kind: 'seen', at })
  })
}

/** A finished predict run: every one of the walkthrough's Q questions answered (asked = Q ≥ 1). */
export async function recordPredict(d: DojoDB, key: string, asked: number, correct: number, at: number): Promise<void> {
  await d.atlasRuns.add({ key, kind: 'predict', at, asked, correct })
}

/** "Which approach did you use?" (§7.3): stores or replaces the answer on a solved session.
 * A targeted `update()` (merges just `approach`), not a get()-then-put() of the whole row: that would
 * clobber any other field a concurrent write landed between the read and the write. */
export async function setSessionApproach(d: DojoDB, sessionId: string, approach: string): Promise<void> {
  const s = await d.sessions.get(sessionId)
  if (!s || s.outcome === 'gave_up') return
  await d.sessions.update(sessionId, { approach })
}

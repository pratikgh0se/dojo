// Approach coverage (TRACKING §3; labs contract §5.6, D-15): per Atlas row, how often he reached for the
// pattern versus how often it was the best answer, counted only from "Which approach did you use?" answers.
import type { Approach } from '../content/approaches'
import { PATTERNS } from '../content/atlas'
import type { Session } from '../data/types'

/** Avoided needs at least this many sessions where the row was the best answer… */
export const AVOID_MIN_BEST = 2
/** …and him reaching for it on fewer than this share of them (D-15). */
export const AVOID_RATIO = 0.5

export type CoverageState = 'none' | 'ok' | 'avoided'
export interface PatternCoverage { used: number; best: number; state: CoverageState }

/**
 * Every answered solved session (solved or solved with help, `approach` set, the problem has approaches):
 * best(P) += 1 for the starred approach's row, used(P) += 1 for the chosen approach's row ('other' counts for none).
 */
export function approachCoverage(sessions: readonly Session[], approaches: Readonly<Record<string, Approach[]>>): Record<string, PatternCoverage> {
  const out: Record<string, PatternCoverage> = Object.fromEntries(PATTERNS.map(p => [p.slug, { used: 0, best: 0, state: 'none' as CoverageState }]))
  for (const s of sessions) {
    const list = approaches[s.ticketId]
    if (!s.approach || s.outcome === 'gave_up' || !list) continue
    const best = list.find(a => a.best)
    const used = list.find(a => a.id === s.approach)
    if (best && out[best.pattern]) out[best.pattern].best += 1
    if (used && out[used.pattern]) out[used.pattern].used += 1
  }
  for (const c of Object.values(out)) {
    c.state = c.best === 0 && c.used === 0 ? 'none' : c.best >= AVOID_MIN_BEST && c.used < c.best * AVOID_RATIO ? 'avoided' : 'ok'
  }
  return out
}

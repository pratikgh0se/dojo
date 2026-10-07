// Seen / predicted (labs contract §4.3, §4.4, §5.1, D-4, D-7, D-17): per walkthrough from the recorded runs,
// then per Atlas row (a row takes the best state of any walkthrough it lists). Monotonic: a later failed
// predict run never downgrades.
import { ATOMS, PATTERNS } from '../content/atlas'
import type { AtlasRun } from '../data/types'
import { predictResult } from './predict'

export type PatternState = 'none' | 'seen' | 'predicted'

const RANK: Record<PatternState, number> = { none: 0, seen: 1, predicted: 2 }
const better = (a: PatternState, b: PatternState) => (RANK[b] > RANK[a] ? b : a)

/** Walkthrough key → its state. A passed predict run counts as predicted (and so as seen). */
export function walkStates(runs: readonly AtlasRun[]): Record<string, PatternState> {
  const out: Record<string, PatternState> = {}
  for (const r of runs) {
    const s: PatternState = r.kind === 'predict' && predictResult(r.correct ?? 0, r.asked ?? 0).passed ? 'predicted' : 'seen'
    out[r.key] = better(out[r.key] ?? 'none', s)
  }
  return out
}

/** Row slug → state: the best state of any walkthrough the row lists (D-4). */
export function patternStates(runs: readonly AtlasRun[]): Record<string, PatternState> {
  const walks = walkStates(runs)
  return Object.fromEntries(PATTERNS.map(p => [p.slug, p.walkthroughs.reduce<PatternState>((acc, k) => better(acc, walks[k] ?? 'none'), 'none')]))
}

/** `16 atoms · 36 patterns · you have predicted M` (§5.1). */
export function atlasSummary(states: Record<string, PatternState>): { atoms: number; patterns: number; predicted: number; text: string } {
  const predicted = Object.values(states).filter(s => s === 'predicted').length
  return { atoms: ATOMS.length, patterns: PATTERNS.length, predicted, text: `${ATOMS.length} atoms · ${PATTERNS.length} patterns · you have predicted ${predicted}` }
}

/** Best finished predict run of a walkthrough (§8 "best predict score"), or null. */
export function bestPredict(runs: readonly AtlasRun[], key: string): { correct: number; asked: number } | null {
  let best: { correct: number; asked: number } | null = null
  for (const r of runs) {
    if (r.key !== key || r.kind !== 'predict' || !r.asked) continue
    const c = r.correct ?? 0
    if (!best || c / r.asked > best.correct / best.asked) best = { correct: c, asked: r.asked }
  }
  return best
}

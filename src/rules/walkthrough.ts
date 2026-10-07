import { walkDef } from '../content/atlas'
import { PIECE_OVERRIDES } from '../content/pieceOverrides'
import type { AlgoJson } from './algoJson'

/** The engine globals a walkthrough is resolved from (set by /engines/algo.js and /engines/atlas-pieces.js). */
export interface AlgoGlobals {
  SRAlgo?: { library: Record<string, unknown>; run(name: string, input?: unknown): AlgoJson }
  SRAtlas?: Record<string, unknown>
}

export type WalkResult = { ok: true; json: AlgoJson } | { ok: false; error: string }

/**
 * Walkthrough key (+ own input for a runnable entry) → step JSON.
 * library: SRAlgo.run(key, input) · piece: the Atlas page's worked example (fixed input).
 */
export function resolveWalk(key: string, input: unknown, g: AlgoGlobals): WalkResult {
  const def = walkDef(key)
  if (!def) return { ok: false, error: `No walkthrough "${key}"` }
  try {
    if (def.source === 'library') {
      if (!g.SRAlgo || !g.SRAlgo.library[key]) return { ok: false, error: 'The algorithm engine is not loaded' }
      return { ok: true, json: g.SRAlgo.run(key, input === undefined ? undefined : input) }
    }
    const raw = g.SRAtlas?.[key]
    if (typeof raw !== 'string') return { ok: false, error: 'The Atlas pieces are not loaded' }
    // UAT r4 J6: a piece whose example disagrees with its own code is rebuilt in the app
    const fixed = PIECE_OVERRIDES[key]
    if (fixed) return { ok: true, json: fixed() }
    return { ok: true, json: JSON.parse(raw) as AlgoJson }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

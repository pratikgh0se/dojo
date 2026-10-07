import { ATLAS_PATTERNS, type AtlasPattern } from '../content/patterns'
import cfTagsJson from '../content/banks/cf-tags.json'
import groupJson from '../content/banks/group-patterns.json'
import lcJson from '../content/banks/lc-patterns.json'

const LC = lcJson as Record<string, string | null>
const GROUP = groupJson as Record<string, Record<string, string | null>>
const CF_TAGS = cfTagsJson as Record<string, string>

const own = (o: object | undefined, k: string): boolean => o !== undefined && Object.prototype.hasOwnProperty.call(o, k)

export function isAtlasPattern(x: unknown): x is AtlasPattern {
  return typeof x === 'string' && (ATLAS_PATTERNS as readonly string[]).includes(x)
}

const asPattern = (x: string | null | undefined): AtlasPattern | null => (isAtlasPattern(x) ? x : null)

/** `plan` is the only bank with built-in group defaults; a pack's items carry their own `pattern`. */
export type PatternBank = 'plan'

/**
 * Spec §2.2. First hit wins: per-number table → plan sprint default (in-plan problems)
 * → bank group default → null. `scripts/banks/lib.mjs` has the same rule; a unit test
 * recomputes every shipped item with this function so the two cannot drift.
 */
export function resolveLcPattern(
  num: number | undefined, planSprint: number | undefined, bank: PatternBank, groupKey: string,
): AtlasPattern | null {
  if (num !== undefined && own(LC, String(num))) return asPattern(LC[String(num)])
  if (planSprint !== undefined) {
    const p = asPattern(GROUP.plan?.[String(planSprint)])
    if (p) return p
  }
  const g = GROUP[bank]
  return own(g, groupKey) ? asPattern(g[groupKey]) : null
}

/** C-BANKS §1: a Codeforces item's pattern is its first tag that maps to an Atlas label. */
export function cfTagPattern(tags: readonly string[]): AtlasPattern | null {
  for (const t of tags) {
    const p = own(CF_TAGS, t) ? asPattern(CF_TAGS[t]) : null
    if (p) return p
  }
  return null
}

export function planSprintByNum(dsaBank: { sprint: number; problems: { num: number }[] }[]): Map<number, number> {
  const out = new Map<number, number>()
  for (const w of dsaBank) for (const p of w.problems) if (!out.has(p.num)) out.set(p.num, w.sprint)
  return out
}

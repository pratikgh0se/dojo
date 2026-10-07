// Codeforces rating-ladder import (C-BANKS §2 "Import ladder"): parses a pasted
// `problemset.problems`-shaped JSON blob into bankItems rows. Named `cfLadder`
// (not `ladder`) because `rules/ladder.ts` already exists for the unrelated
// help-ladder/redo XP system (see tests/unit/ladder.test.ts) — the plan's
// literal path collided with it; this file replaces that path for chain B.
import type { BankItem } from '../data/types'
import { cfTagPattern } from './bankPatterns'

export interface LadderItem { contestId: number; index: string; name: string; rating: number; tags: string[] }
export type LadderParse = { ok: true; items: LadderItem[] } | { ok: false; error: string }

export const LADDER_ERROR = 'Invalid ladder JSON'

export const ladderId = (x: { contestId: number; index: string }): string => `cf-${x.contestId}${x.index}`

function listOf(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw
  const problems = (raw as { result?: { problems?: unknown } } | null)?.result?.problems
  return Array.isArray(problems) ? problems : null
}

/** C-BANKS S-33/S-34: an array (or the API's {result: {problems}}) of {contestId, index, name, rating, tags?}. */
export function parseLadderJson(text: string): LadderParse {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: `${LADDER_ERROR}: not valid JSON` }
  }
  const list = listOf(raw)
  if (!list || list.length === 0) return { ok: false, error: `${LADDER_ERROR}: expected a non-empty array of problems` }
  const items: LadderItem[] = []
  for (let i = 0; i < list.length; i++) {
    const x = (list[i] ?? {}) as Record<string, unknown>
    const ok = Number.isInteger(x.contestId) && (x.contestId as number) > 0 &&
      typeof x.index === 'string' && /^[a-z][0-9]?$/i.test(x.index) &&
      typeof x.name === 'string' && x.name.trim().length > 0 &&
      Number.isInteger(x.rating) && (x.rating as number) > 0 &&
      (x.tags === undefined || (Array.isArray(x.tags) && x.tags.every(t => typeof t === 'string')))
    if (!ok) return { ok: false, error: `${LADDER_ERROR}: item ${i + 1} needs contestId, index, name and rating` }
    items.push({
      contestId: x.contestId as number, index: (x.index as string).toUpperCase(), name: (x.name as string).trim(),
      rating: x.rating as number, tags: (x.tags as string[] | undefined) ?? [],
    })
  }
  return { ok: true, items }
}

/** Merge by id: existing ids are left untouched (C-BANKS §2). */
export function splitLadder(items: LadderItem[], existing: ReadonlySet<string>): { fresh: LadderItem[]; present: number } {
  const seen = new Set<string>()
  const fresh: LadderItem[] = []
  let present = 0
  for (const x of items) {
    const id = ladderId(x)
    if (seen.has(id)) continue
    seen.add(id)
    if (existing.has(id)) present++
    else fresh.push(x)
  }
  return { fresh, present }
}

export function ladderRow(x: LadderItem, nowMs: number): BankItem {
  const key = ladderId(x)
  return {
    id: `codeforces:${key}`, bank: 'codeforces', key, name: x.name,
    url: `https://codeforces.com/problemset/problem/${x.contestId}/${x.index}`,
    pattern: cfTagPattern(x.tags), rating: x.rating, status: 'todo', addedAt: nowMs,
  }
}

export function ladderResultText(fresh: number, present: number): string {
  return `${fresh} new, ${present} already present`
}

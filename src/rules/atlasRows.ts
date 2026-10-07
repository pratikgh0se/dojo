// Atlas rows (labs contract §5.2–5.4, D-12, D-13): the plan problems tagged with each row, the Left count,
// the sort, and the local search filter.
import type { Approach } from '../content/approaches'
import { PATTERNS, type Pattern } from '../content/atlas'
import type { PlanJson, Ticket } from '../data/types'
import { liveTicketMap } from './board'

export interface TaggedProblem { id: string; num: number; name: string; sprint: number; solved: boolean }

/** Plan-bank problems tagged with every row any of their approaches uses, in plan (sprint) order. */
export function problemsByPattern(plan: PlanJson, tickets: readonly Ticket[], approaches: Readonly<Record<string, Approach[]>>): Record<string, TaggedProblem[]> {
  const byId = liveTicketMap([...tickets])
  const out: Record<string, TaggedProblem[]> = Object.fromEntries(PATTERNS.map(p => [p.slug, [] as TaggedProblem[]]))
  for (const w of [...plan.dsa_bank].sort((a, b) => a.sprint - b.sprint)) {
    for (const p of w.problems) {
      const id = `p${p.num}`
      const solved = byId.get(id)?.status === 'done'
      for (const slug of new Set((approaches[id] ?? []).map(a => a.pattern))) out[slug]?.push({ id, num: p.num, name: p.name, sprint: w.sprint, solved })
    }
  }
  return out
}

/** "Problems left in my sprint bank" (D-12): unsolved tagged plan problems. */
export function problemsLeft(tagged: readonly TaggedProblem[]): number {
  return tagged.filter(t => !t.solved).length
}

export type RowSort = 'map' | 'left'

/** Prototype order, or Left descending with prototype order breaking ties (§5.3). */
export function sortRows(sort: RowSort, tagged: Record<string, TaggedProblem[]>): Pattern[] {
  if (sort === 'map') return [...PATTERNS]
  return PATTERNS.map((p, i) => ({ p, i, left: problemsLeft(tagged[p.slug]) }))
    .sort((a, b) => b.left - a.left || a.i - b.i)
    .map(x => x.p)
}

/**
 * Filter while typing (§5.4): a row stays when its label contains the text, or one of its tagged plan
 * problems matches by number (exact) or name (substring). Case-insensitive; blank keeps every row.
 */
export function rowMatches(p: Pattern, query: string, tagged: Record<string, TaggedProblem[]>): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (p.label.toLowerCase().includes(q)) return true
  return tagged[p.slug].some(t => String(t.num) === q || t.name.toLowerCase().includes(q))
}

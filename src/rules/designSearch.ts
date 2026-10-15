import type { DesignItemView, DesignTierView } from './designs'

/** NAV-33: lower case, split at spaces, repeated spaces gone. A query of only spaces is empty. */
export const normalizeQuery = (q: string): string => q.toLowerCase().split(/\s+/).filter(Boolean).join(' ')

const DIFFICULTY_WORD: Record<string, string> = { E: 'easy', M: 'medium', H: 'hard' }

/** The row's extra chips, in display order (the difficulty and "plan S<n>" chips are not extra). The Designs rows have none today; the screen draws each as `designs-row-chip-<id>-<n>` and a query matches its text (NAV-33). */
export const extraChips = (_it: DesignItemView): string[] => []

/**
 * What a Designs row can be found by: its title, its tier name as the ladder shows it (no "(sprints a to b)"), its
 * difficulty word and the text of any other chip the row shows (the difficulty chip's letter; "plan S<n>" is left out).
 */
export function designSearchText(it: DesignItemView, tier: Pick<DesignTierView, 'label'>): string {
  return [it.title, tier.label, DIFFICULTY_WORD[it.difficulty] ?? '', ...extraChips(it)].join(' ').toLowerCase()
}

export interface DesignSearchGroup { tier: DesignTierView; items: DesignItemView[] }

/** The rows whose searchable text holds every word of the query, grouped by tier in tier and bank order. Tiers without a hit are left out. */
export function filterDesigns(tiers: readonly DesignTierView[], query: string): DesignSearchGroup[] {
  const words = normalizeQuery(query).split(' ').filter(Boolean)
  if (words.length === 0) return []
  return tiers
    .map(tier => ({ tier, items: tier.items.filter(it => { const text = designSearchText(it, tier); return words.every(w => text.includes(w)) }) }))
    .filter(g => g.items.length > 0)
}

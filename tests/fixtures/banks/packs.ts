import type { BankTabDef, BankTabId } from '../../../src/content/banks/meta'
import type { LoadedPacks } from '../../../src/content/banks/packs'

/** Original, made-up fixture packs for the tests. No third-party list content. Same shape as src/content/banks/packs.ts. */
export type { LoadedPacks }

const SNAP = '2026-01-01'

export const PACK_META: readonly BankTabDef[] = [
  { id: 'neetcode150', label: 'Fixture Set A', source: 'https://example.com/fixture-sets/a', snapshot: SNAP },
  { id: 'blind75', label: 'Fixture Set B', source: 'https://example.com/fixture-sets/b', snapshot: SNAP },
  { id: 'striver', label: 'Fixture Set C', source: 'https://example.com/fixture-sets/c', snapshot: SNAP },
  { id: 'codeforces', label: 'Fixture Ladder', source: 'https://example.com/fixture-sets/ladder', snapshot: SNAP },
  { id: 'hellointerview', label: 'Fixture Designs', source: 'https://example.com/fixture-sets/designs', snapshot: SNAP },
]

/** Set B precedes Set A so a problem both contain is reported as Set B (the Known item rule). */
export const PACK_KNOWN_ORDER: readonly BankTabId[] = ['blind75', 'neetcode150', 'striver', 'codeforces', 'hellointerview']

export const PACK_DESIGN_OVERLAP: Readonly<Record<string, string>> = {
  'hi-fx-chat': 'd-chat',
  'hi-fx-cache': 'd-cache',
}

export async function loadPacks(): Promise<LoadedPacks> {
  const [a, b, c, d, e] = await Promise.all([
    import('./neetcode150.json'), import('./blind75.json'), import('./striver.json'),
    import('./codeforces.json'), import('./hellointerview.json'),
  ])
  return {
    neetcode150: a.default as never, blind75: b.default as never, striver: c.default as never,
    codeforces: d.default as never, hellointerview: e.default as never,
  }
}

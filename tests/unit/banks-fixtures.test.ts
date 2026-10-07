import { describe, expect, it } from 'vitest'
import { ATLAS_PATTERNS } from '../../src/content/patterns'
import { loadPacks } from '@bank-packs'

// The suite runs against original, made-up fixture packs (tests/fixtures/banks); the public build ships none.
describe('fixture bank packs', () => {
  it('are well formed and only use Atlas pattern labels', async () => {
    const packs = await loadPacks()
    expect(Object.keys(packs).sort()).toEqual(['blind75', 'codeforces', 'hellointerview', 'neetcode150', 'striver'])
    for (const [id, b] of Object.entries(packs)) {
      expect(b!.bank).toBe(id)
      const ids = new Set<string>()
      for (const it of b!.items) {
        expect(ids.has(it.id), `duplicate ${it.id}`).toBe(false)
        ids.add(it.id)
        expect(b!.groups).toContain(it.group)
        expect(it.pattern === null || (ATLAS_PATTERNS as readonly string[]).includes(it.pattern)).toBe(true)
        expect(it.url).toMatch(/^https:\/\//)
      }
      expect([...new Set(b!.items.map(i => i.group))]).toEqual(b!.groups)
    }
  })
})

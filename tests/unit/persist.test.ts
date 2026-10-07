import { describe, expect, it } from 'vitest'
import { ensurePersistence, resetPersistenceCache } from '../../src/data/persist'

describe('ensurePersistence (Important #3, storage durability)', () => {
  it('reports "persistent" when the browser grants it', async () => {
    resetPersistenceCache()
    const nav = { storage: { persist: async () => true } }
    expect(await ensurePersistence(nav)).toBe('persistent')
  })

  it('reports "best-effort" when the browser declines', async () => {
    resetPersistenceCache()
    const nav = { storage: { persist: async () => false } }
    expect(await ensurePersistence(nav)).toBe('best-effort')
  })

  it('reports "unavailable" when navigator.storage.persist does not exist', async () => {
    resetPersistenceCache()
    expect(await ensurePersistence({})).toBe('unavailable')
    resetPersistenceCache()
    expect(await ensurePersistence(undefined)).toBe('unavailable')
  })

  it('reports "unavailable" if persist() throws', async () => {
    resetPersistenceCache()
    const nav = { storage: { persist: async () => { throw new Error('nope') } } }
    expect(await ensurePersistence(nav)).toBe('unavailable')
  })

  it('is idempotent: only calls persist() once even if invoked again', async () => {
    resetPersistenceCache()
    let calls = 0
    const nav = { storage: { persist: async () => { calls += 1; return true } } }
    await ensurePersistence(nav)
    await ensurePersistence(nav)
    expect(calls).toBe(1)
  })
})

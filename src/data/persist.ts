import { useEffect, useState } from 'react'

export type StorageStatus = 'persistent' | 'best-effort' | 'unavailable'

export const STORAGE_STATUS_LABEL: Record<StorageStatus, string> = {
  persistent: 'persistent',
  'best-effort': 'best-effort (browser may evict)',
  unavailable: 'unavailable',
}

type NavigatorLike = { storage?: { persist?: () => Promise<boolean> } }

let pending: Promise<StorageStatus> | null = null

// Requests durable ("persistent") storage from the browser once at boot, so IndexedDB
// data is less likely to be evicted under storage pressure. Guards for browsers that
// don't expose the API at all. Idempotent: repeated calls reuse the same in-flight/
// resolved promise instead of re-prompting the browser.
export function ensurePersistence(nav: NavigatorLike | undefined = typeof navigator !== 'undefined' ? navigator : undefined): Promise<StorageStatus> {
  if (!pending) {
    pending = (async (): Promise<StorageStatus> => {
      if (!nav?.storage?.persist) return 'unavailable'
      try {
        const granted = await nav.storage.persist()
        return granted ? 'persistent' : 'best-effort'
      } catch {
        return 'unavailable'
      }
    })()
  }
  return pending
}

// Test-only: clears the cached result so a fresh navigator.storage mock is honoured.
export function resetPersistenceCache(): void {
  pending = null
}

export function useStorageStatus(): StorageStatus | null {
  const [status, setStatus] = useState<StorageStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    void ensurePersistence().then(s => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return status
}

import { useEffect, useState } from 'react'
import { loadPacks, type LoadedPacks } from '@bank-packs'

export type ShippedBanks = LoadedPacks

let cached: ShippedBanks | null = null
let inflight: Promise<ShippedBanks> | null = null

function load(): Promise<ShippedBanks> {
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    inflight = loadPacks().then(m => {
      cached = m
      return cached
    })
  }
  return inflight
}

/**
 * Bank packs (none in the public build) are dynamically imported here instead of statically
 * from `Banks.tsx`, so Vite puts any pack JSON in its own chunk instead of the main one. `null` while loading; the screen shows its existing Loading state.
 */
export function useShippedBanks(): ShippedBanks | null {
  const [state, setState] = useState<ShippedBanks | null>(cached)
  useEffect(() => {
    if (state) return
    let alive = true
    void load().then(v => {
      if (alive) setState(v)
    })
    return () => {
      alive = false
    }
  }, [state])
  return state
}

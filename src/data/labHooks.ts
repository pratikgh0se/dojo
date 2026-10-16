// UI read hooks over the R2 lab tables and the server's lab definitions (R2 W3). The only place the UI reads labs, labRuns and labReviews.
import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useState } from 'react'
import { fetchDataHome } from './dataHome'
import { useDb } from './dbContext'
import { fetchLabInfo, type LabInfo } from './labActions'
import type { CheckAttemptRow, LabReviewRow, LabRow, LabRunRow } from './types'

export type LabInfos = Readonly<Record<string, LabInfo>>

/** The lab's own row: null when it was never set up, undefined while loading. */
export function useLabRow(labId: string): LabRow | null | undefined {
  const d = useDb()
  return useLiveQuery(async () => (labId ? (await d.labs.get(labId)) ?? null : null), [d, labId])
}
/** One lab's runs, oldest first. */
export function useLabRuns(labId: string): LabRunRow[] | undefined {
  const d = useDb()
  return useLiveQuery(async () => (labId ? (await d.labRuns.where('labId').equals(labId).toArray()).sort((a, b) => a.at - b.at) : []), [d, labId])
}
export function useAllLabRuns(): LabRunRow[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.labRuns.toArray(), [d])
}
/** Every review of every lab, oldest first. */
export function useLabReviews(): LabReviewRow[] | undefined {
  const d = useDb()
  return useLiveQuery(async () => (await d.labReviews.toArray()).sort((a, b) => a.at - b.at), [d])
}
export function useAllCheckAttempts(): CheckAttemptRow[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.checkAttempts.toArray(), [d])
}

// A lab definition does not change while the server runs, so a found definition is kept for the page's life. A miss is not cached (the
// server may simply not have been up yet), so the next mount asks again.
const cache = new Map<string, LabInfo>()
export const resetLabInfoCache = (): void => cache.clear()

/** The definitions of these labs that exist, by lab id. `undefined` until every request has settled; an unreachable server settles to what is cached. */
export function useLabInfos(labIds: readonly string[]): LabInfos | undefined {
  const key = [...new Set(labIds)].sort().join('|')
  const [infos, setInfos] = useState<LabInfos | undefined>(undefined)
  useEffect(() => {
    let live = true
    const ids = key ? key.split('|') : []
    void Promise.all(ids.map(async id => {
      const hit = cache.get(id)
      if (hit) return [id, hit] as const
      const got = await fetchLabInfo(id).catch(() => null)
      if (got) cache.set(id, got)
      return [id, got] as const
    })).then(pairs => {
      if (live) setInfos(Object.fromEntries(pairs.filter((p): p is readonly [string, LabInfo] => p[1] !== null)))
    })
    return () => { live = false }
  }, [key])
  return infos
}

/** The learner's home folder as the server knows it (`GET /db/health`), for showing a lab folder as an absolute path. Undefined until known or when unknown. */
export function useUserHome(): string | undefined {
  const [home, setHome] = useState<string | undefined>(undefined)
  useEffect(() => {
    let live = true
    void fetchDataHome().then(h => { if (live) setHome(h?.userHome) })
    return () => { live = false }
  }, [])
  return home
}

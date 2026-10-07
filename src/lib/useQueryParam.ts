import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Query-string selection state. set() pushes a history entry so Back restores the previous selection. */
export function useQuery(): { params: URLSearchParams; set: (patch: Record<string, string | number | null>) => void } {
  const [params, setParams] = useSearchParams()
  const set = useCallback(
    (patch: Record<string, string | number | null>) => {
      setParams(prev => {
        const next = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) next.delete(k)
          else next.set(k, String(v))
        }
        return next
      })
    },
    [setParams],
  )
  return { params, set }
}

export function intParam(params: URLSearchParams, name: string): number | null {
  const v = params.get(name)
  return v !== null && /^-?\d+$/.test(v) ? Number(v) : null
}

/** Like intParam, but also accepts the `S<n>` sprint form (Controller addendum 2: `?topic=S<n>`
 * as well as a bare number — e.g. a topic link crafted from a plan's own `S<n>` sprint labels). */
export function sprintParam(params: URLSearchParams, name: string): number | null {
  const v = params.get(name)
  if (v === null) return null
  const m = /^S(\d+)$/i.exec(v)
  if (m) return Number(m[1])
  return /^-?\d+$/.test(v) ? Number(v) : null
}

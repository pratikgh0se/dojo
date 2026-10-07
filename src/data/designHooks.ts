import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from './dbContext'
import type { DesignSession } from './types'

export function useDesignSessions(designId?: string): DesignSession[] | undefined {
  const d = useDb()
  return useLiveQuery(
    () => (designId ? d.designSessions.where('designId').equals(designId).toArray() : d.designSessions.toArray()),
    [d, designId],
  )
}

import { createContext, useContext, type ReactNode } from 'react'
import type { DojoDB } from './db'

const DbContext = createContext<DojoDB | null>(null)

export function useDb(): DojoDB {
  const d = useContext(DbContext)
  if (!d) throw new Error('useDb must be used inside AppProviders')
  return d
}

export function DbProvider({ db, children }: { db: DojoDB; children: ReactNode }) {
  return <DbContext.Provider value={db}>{children}</DbContext.Provider>
}

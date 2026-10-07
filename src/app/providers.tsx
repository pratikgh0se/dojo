import { createContext, useContext, type ReactNode } from 'react'
import { DbProvider, useDb } from '../data/dbContext'
import type { DojoDB } from '../data/db'
import type { PlanJson } from '../data/types'
import { FlashProvider, PowerUpProvider, ToastProvider } from '../ui/primitives'

export { useDb }

const PlanContext = createContext<PlanJson | null>(null)

export function usePlan(): PlanJson {
  const p = useContext(PlanContext)
  if (!p) throw new Error('usePlan must be used inside AppProviders')
  return p
}

export function AppProviders({ db, plan, children }: { db: DojoDB; plan: PlanJson; children: ReactNode }) {
  return (
    <DbProvider db={db}>
      <PlanContext.Provider value={plan}>
        <ToastProvider>
          <FlashProvider>
            <PowerUpProvider>{children}</PowerUpProvider>
          </FlashProvider>
        </ToastProvider>
      </PlanContext.Provider>
    </DbProvider>
  )
}

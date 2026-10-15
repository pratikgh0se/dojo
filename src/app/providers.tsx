import { createContext, useContext, type ReactNode } from 'react'
import { DbProvider, useDb } from '../data/dbContext'
import type { DojoDB } from '../data/db'
import { isPlanV2, type PlanV2 } from '../data/planV2'
import type { PlanJson } from '../data/types'
import { PomRewardProvider } from '../ui/PomReward'
import { FlashProvider, ToastProvider } from '../ui/primitives'

export { useDb }

const PlanContext = createContext<PlanJson | null>(null)

/** The slim plan view the bank screens read (banks, id map, version, learner links); see `PlanJson`. */
export function usePlan(): PlanJson {
  const p = useContext(PlanContext)
  if (!p) throw new Error('usePlan must be used inside AppProviders')
  return p
}

const PlanV2Context = createContext<PlanV2 | null>(null)

/** The plan v2 (areas, phases, nodes, mix), or null when a test hands the providers a bare slim plan. */
export function usePlanV2(): PlanV2 | null {
  return useContext(PlanV2Context)
}

/** The plan v2 for screens that only exist on a v2 plan (S7). Throws a clear error when there is none. */
export function useRequiredPlanV2(): PlanV2 {
  const p = useContext(PlanV2Context)
  if (!p) throw new Error('useRequiredPlanV2: no plan v2 is loaded (the app needs plan v2 here, or this is outside AppProviders)')
  return p
}

/** `planV2` is the v2 plan beside its slim view; when `plan` is itself a v2 plan and `planV2` is omitted, `plan` is used. */
export function AppProviders({ db, plan, planV2, children }: { db: DojoDB; plan: PlanJson; planV2?: PlanV2 | null; children: ReactNode }) {
  const v2 = planV2 !== undefined ? planV2 : isPlanV2(plan) ? plan : null
  return (
    <DbProvider db={db}>
      <PlanContext.Provider value={plan}>
        <PlanV2Context.Provider value={v2}>
          <ToastProvider>
            <FlashProvider>
              <PomRewardProvider>{children}</PomRewardProvider>
            </FlashProvider>
          </ToastProvider>
        </PlanV2Context.Provider>
      </PlanContext.Provider>
    </DbProvider>
  )
}

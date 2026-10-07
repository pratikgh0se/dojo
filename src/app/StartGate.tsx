import type { ReactNode } from 'react'
import { useSettings } from '../data/hooks'
import { Onboarding } from '../screens/Onboarding'

export function StartGate({ children }: { children: ReactNode }) {
  const settings = useSettings()
  if (!settings) return <p className="boot">Loading…</p>
  if (!settings.startDate) return <Onboarding />
  return <>{children}</>
}

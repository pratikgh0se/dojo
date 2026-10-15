import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppProviders, usePlanV2, useRequiredPlanV2 } from '../../src/app/providers'
import type { PlanV2 } from '../../src/data/planV2'
import { freshDb } from '../helpers/db'
import { flatPlanV2, smallPlanV2 } from '../helpers/plan'

const wrap = (plan: Parameters<typeof AppProviders>[0]['plan'], planV2?: PlanV2 | null) =>
  ({ children }: { children: React.ReactNode }) => <AppProviders db={freshDb()} plan={plan} planV2={planV2}>{children}</AppProviders>

describe('useRequiredPlanV2 (R2: next to the nullable usePlanV2)', () => {
  it('returns the v2 plan it was given', () => {
    const { result } = renderHook(() => useRequiredPlanV2(), { wrapper: wrap(flatPlanV2, flatPlanV2) })
    expect(result.current).toBe(flatPlanV2)
  })
  it('uses the plan itself when AppProviders gets a v2 plan and no separate planV2', () => {
    const { result } = renderHook(() => ({ req: useRequiredPlanV2(), nullable: usePlanV2() }), { wrapper: wrap(smallPlanV2) })
    expect(result.current.req).toBe(smallPlanV2)
    expect(result.current.nullable).toBe(smallPlanV2)
  })
  it('throws a clear error when only a v1 plan is loaded', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => renderHook(() => useRequiredPlanV2(), { wrapper: wrap(flatPlanV2, null) })).toThrow(/useRequiredPlanV2: no plan v2 is loaded/)
    } finally { spy.mockRestore() }
  })
  it('throws outside AppProviders', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => renderHook(() => useRequiredPlanV2())).toThrow(/useRequiredPlanV2/)
    } finally { spy.mockRestore() }
  })
  it('usePlanV2 stays nullable: null when the providers are given planV2 null', () => {
    const { result } = renderHook(() => usePlanV2(), { wrapper: wrap(flatPlanV2, null) })
    expect(result.current).toBeNull()
  })
})

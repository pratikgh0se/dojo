import type { Settings } from '../data/types'

export const DEFAULT_BUDGETS: readonly number[] = [90, 60, 60, 60, 30, 30, 150]
export const MAX_BUDGET_MIN = 600
export const DEFAULT_SESSION_MINUTES = 25
export const MIN_SESSION_MINUTES = 5
export const MAX_SESSION_MINUTES = 180
export const MIN_CORE_MINUTES = 30
export const MAX_CORE_MINUTES = 20160
export type NavLabels = 'intro' | 'always' | 'hover'

export function validBudgets(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === 7 && v.every(n => Number.isInteger(n) && n >= 0 && n <= MAX_BUDGET_MIN)
}

/** The weekday minutes (Sunday first): a valid stored override, else the plan's mix, else the defaults. */
export function budgetsOf(s: Pick<Settings, 'laneBudgets'> | undefined, mix?: { budgets: number[] }): number[] {
  const stored = s?.laneBudgets
  if (validBudgets(stored)) return [...stored]
  const planned = mix?.budgets
  if (validBudgets(planned)) return [...planned]
  return [...DEFAULT_BUDGETS]
}

export const weeklyTotal = (b: readonly number[]): number => b.reduce((a, n) => a + n, 0)

/** "Core minutes per fortnight": a valid stored value, else twice the weekly total (960 by default). */
export function coreMinutesOf(s: Pick<Settings, 'coreMinutes' | 'laneBudgets'> | undefined, mix?: { budgets: number[] }): number {
  const v = s?.coreMinutes
  if (typeof v === 'number' && Number.isFinite(v) && v >= MIN_CORE_MINUTES) return v
  return 2 * weeklyTotal(budgetsOf(s, mix))
}

export const careerLaneOf = (s: Pick<Settings, 'careerLane'> | undefined): boolean => s?.careerLane === true

export function sessionMinutesOf(s: Pick<Settings, 'sessionMinutes'> | undefined): number {
  const v = s?.sessionMinutes
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_SESSION_MINUTES && v <= MAX_SESSION_MINUTES ? v : DEFAULT_SESSION_MINUTES
}

export function navLabelsOf(s: Pick<Settings, 'navLabels'> | undefined): NavLabels {
  const v = s?.navLabels
  return v === 'always' || v === 'hover' ? v : 'intro'
}

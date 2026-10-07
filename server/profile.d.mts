export const PROFILE_FILE: string
export const PLAN_OVERLAY_KEYS: string[]
export function readProfile(home: string | undefined | null): Record<string, unknown>
export function expandHome(p: string, home?: string): string
export function resolveProjectRepo(env?: Record<string, string | undefined>, profile?: Record<string, unknown>, home?: string): string | null
export function overlayPlan(planText: string, profile: Record<string, unknown> | undefined): string

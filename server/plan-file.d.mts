export class PlanFileError extends Error {}
export function planFileSetting(env?: Record<string, string | undefined>): string | null
export function readPlanFile(path: string): string
export function resolvePlanFile(env?: Record<string, string | undefined>): { path: string; json: Record<string, unknown> } | null

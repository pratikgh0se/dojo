import type { LabResults, LabRunReply } from './index.mjs'
export const TAIL_CHARS: number
export function validateResults(raw: unknown): LabResults | null
export function labEnv(env: Record<string, string | undefined>): Record<string, string>
export function runChecks(o: { dir: string; timeoutSec: number; env: Record<string, string | undefined>; signal?: AbortSignal }): Promise<LabRunReply>

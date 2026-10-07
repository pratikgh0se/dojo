type Env = Record<string, string | undefined>
export class JobError extends Error {
  code: string
  constructor(code: string, message: string)
}
export const KILL_GRACE_MS: number
export function resolveBin(bin: string, env?: Env): string | null
export function claudeEnv(env?: Env): Env
export const SIGNED_OUT: RegExp
export function reportsSignedOut(bin: string, env?: Env): Promise<boolean>
export function claudeArgs(job: string): string[]
export function buildPrompt(job: string, req: { ticket: unknown; context: unknown }, evidence?: string): string
export function parseEnvelope(stdout: string): string
export function parseOutput(job: string, text: string, req?: { context?: unknown }): { ok: true; output: unknown } | { ok: false; error: string }
export function runClaude(bin: string, args: string[], prompt: string, opts: { timeoutMs: number; env?: Env; signal?: AbortSignal | null }): Promise<string>
export function gitEvidence(path: string, commit?: unknown): Promise<string>
export function gitRepoProblem(path: string): Promise<string | null>
export function runClaudeJob(
  job: string,
  req: { ticket: unknown; context: Record<string, unknown> },
  opts: { bin: string; timeoutMs: number; env?: Env; repoPath?: string | null; signal?: AbortSignal | null; noRetry?: boolean },
): Promise<unknown>

export class PortfolioError extends Error { code: string; hits?: { file: string; line: number; rule: string; text: string }[]; constructor(code: string, message: string, extra?: Record<string, unknown>) }
export interface RunResult { status: number | null; stdout: string | Buffer; stderr: string; error?: Error & { code?: string } }
export interface RunOptions { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; buffer?: boolean }
export function tail(s: unknown, n?: number): string
export function run(cmd: string, args: string[], o?: RunOptions): Promise<RunResult>
export function git(cwd: string, args: string[], o?: RunOptions): Promise<RunResult>

import type { Server } from 'node:http'
import type { HelperConfig } from './helper.mjs'
import type { Dojo } from './db/manager.mjs'
export const MAX_OPS_BODY_BYTES: number
export const MAX_RUN_BODY_BYTES: number
export interface DojoServerConfig extends HelperConfig { dist: string | null; dojoPort: number; dbOrigins: Set<string>; linkcheckAllowLoopback: boolean; runEnv: Record<string, string | undefined>; cspReportFile?: string | null; runnerAllowRawImports?: boolean }
export function readServerConfig(argv?: string[], env?: Record<string, string | undefined>): DojoServerConfig
export function createDojoServer(cfg: DojoServerConfig, clock?: () => Date): {
  server: Server; readonly dojo: Dojo; runner: import('./runner/runner.mjs').Runner; logger: { file: string; log(l: string): void }
  listen(port?: number): Promise<number>; close(): Promise<void>
}
export function main(argv?: string[], env?: Record<string, string | undefined>): Promise<unknown>
export function parentPid(argv: string[]): number | null
export function resolveHome(argv: string[], env: Record<string, string | undefined>): string
export const REAL_APP_PORT: number
export function requestPath(req: { url?: string }): string | null
export function guardHandler<Req, Res>(handler: (req: Req, res: Res) => unknown, log: (msg: string) => void): (req: Req, res: Res) => void
export function installCrashGuards(log: (msg: string) => void, proc?: { on(event: string, fn: (e: unknown) => void): unknown }): void

export function gracefulStop(s: { close(): Promise<void>; runner: { settled(): Promise<void>; abort?(): void; sweep?(o?: { shutdown?: boolean }): Promise<number> } }, ms?: number): Promise<void>

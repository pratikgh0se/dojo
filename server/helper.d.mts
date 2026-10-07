import type { IncomingMessage, Server, ServerResponse } from 'node:http'
type Env = Record<string, string | undefined>
export interface HelperConfig {
  fake: boolean
  noRetry: boolean
  port: number
  claudeBin: string
  timeoutMs: number
  limit: number
  /** G6: DOJO_PROJECT_REPO / profile.json projectRepo, absolute; null when unset */
  projectRoot: string | null
  home: string
  /** the account's home folder, where `~` in a repoPath points (the app's own data `home` may differ) */
  userHome?: string
  originAllowList: Set<string>
  env: Env
}
export const HOST: string
export const MODEL: string
export const JOBS: string[]
export const STATUS: Record<string, number>
export const MAX_BODY_BYTES: number
export const MAX_FAKE_DELAY_MS: number
export function buildOriginAllowList(env?: Env, opts?: { devPorts?: boolean }): Set<string>
export function readConfig(argv?: string[], env?: Env): HelperConfig
export function allowedRepoPath(p: unknown, projectRoot: string | null, home?: string): string | null
export function validateRequest(job: string, body: unknown, cfg: HelperConfig): { request: { ticket: unknown; context: Record<string, unknown> }; repoPath: string | null }
export function createHelper(cfg: HelperConfig): Server
export function main(argv?: string[], env?: Env): Server
export function createHelperHandler(cfg: HelperConfig): (req: IncomingMessage, res: ServerResponse) => Promise<void>
export function hostOriginProblem(req: IncomingMessage, cfg: HelperConfig): { code: string; message: string } | null
export function corsHeaders(req: IncomingMessage, cfg: HelperConfig): Record<string, string>
export function readBody(req: IncomingMessage, limit?: number): Promise<string>

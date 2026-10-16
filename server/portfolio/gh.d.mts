import type { RunOptions, RunResult } from './util.mjs'
export interface GhDeps { env: NodeJS.ProcessEnv; ghBin: string; extraTerms?: string[] }
export const GH_SIGNED_OUT: string
export function gh(deps: GhDeps, args: string[], o?: RunOptions): Promise<RunResult>
export function ghLogin(deps: GhDeps): Promise<string>

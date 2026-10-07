export interface PackParam { name: string; type: string }
export interface PackCase { args: unknown[]; expected: unknown }
export interface Pack {
  id: string; title: string; fn: string; signature: string; params: PackParam[]; returns: string
  starter: string; cases: PackCase[]; ref: string
}
export interface PublicPack {
  id: string; title: string; fn: string; signature: string; starter: string; examples: number
  cases: { id: number; call: string; expected: unknown }[]
}
export type RunStatus = 'ok' | 'compile_error' | 'runtime_error' | 'timeout' | 'output_limit' | 'memory_limit' | 'no_toolchain'
export interface RunCase { id: number; call: string; expected: unknown; got: unknown; pass: boolean }
export interface RunError { line: number; col: number; message: string }
/** `case`: set on a case's first event (M5; internal, not an extra step). */
export type Step = (
  | { op: 'table'; t: number; rows: number; cols: number; name: string }
  | { op: 'set'; t: number; i: number; j: number; v: number; deps: [number, number][]; rule?: string }
  | { op: 'get'; t: number; i: number; j: number; v: number }
  | { op: 'enter' | 'hit'; fn: string; args: number[] }
  | { op: 'exit'; v: number }
  | { op: 'link'; fn: string; table: string }
  /** C-VISUAL §2: a family step (stepShape.mjs has every action's fields) */
  | { op: 'unshown'; kind?: string }
  | { op: 'graph' | 'heap' | 'queue' | 'dsu' | 'array' | 'search' | 'list' | 'intervals' | 'tree' | 'game'; sid: number; act: string; [field: string]: unknown }
) & { case?: number }
export interface RunResult {
  status: RunStatus; cases: RunCase[]; errors: RunError[]; stdout: string; steps: Step[]; truncated: boolean; ms: number
}
export interface Limits {
  wallMs: number; wallGraceMs: number; cpuSoftSec: number; cpuHardSec: number; outputBytes: number; eventBytes: number; rssBytes: number; codeBytes: number; compileMs: number; maxEvents: number
  stdoutCap: number; stderrCap: number; rssPollMs: number; buildRssBytes: number; buildRssPollMs: number
  diskBytes: number; diskEntries: number; diskPollMs: number; buildFileBytes: number; maxGoroutines: number; cacheBytes: number; cacheCheckMs: number
}
export const PACKS_DIR: string
export const TK_SOURCE: string
export const TK_DIR: string
export const PACK_IDS: string[]
export const EXAMPLES: number
export const LIMITS: Limits
export const STATUSES: RunStatus[]
export function loadPacks(dir?: string): Map<string, Pack>
export function showValue(v: unknown): string
export function callText(pack: Pick<Pack, 'fn'>, args: unknown[]): string
export function publicPack(pack: Pack): PublicPack
export function goLiteral(type: string, v: unknown): string
export function startsWithPackageClause(code: string): boolean
export function prepareSource(code: string): { source: string; offset: number }
export function harnessMain(pack: Pack, cases: PackCase[], limits?: Limits): string
export function wireLimits(o: { limits?: Limits; prog: string }): string
export function parseCompileErrors(text: string, offset: number, fnLine?: number, ctx?: { tmp?: string; pack?: Pack; code?: string } | null): RunError[]
export function functionLine(code: string, fn: string): number
export function parseEvents(text: string, maxEvents?: number, key?: string | null): { steps: Step[]; truncated: boolean }
export function framedLines(text: string, key?: string | null): string[]
export function parseResults(text: string, key?: string | null): { byId: Map<number, Record<string, unknown>>; limit: string | null; done: boolean }
export function treeUsage(dir: string, maxEntries?: number): { bytes: number; entries: number; over: boolean }
export function treeUsageAsync(dir: string, maxEntries?: number): Promise<{ bytes: number; entries: number; over: boolean }>
export function crashMessage(r: { stderr?: string; code?: number | null; signal?: string | null }): string
export function refusedDirectives(code: string, o?: { allowRaw?: boolean }): RunError[]
export const RAW_IMPORT_MESSAGE: string
export function importPaths(code: string): { path: string; line: number }[]
export function sandboxProfile(o: { tmp: string; prog: string; home?: string; dojoHome?: string | null; appDir?: string }): string
export function buildProfile(o: { tmp: string; cache: string; appDir?: string }): string
export const APP_DIR: string
export function resolveGo(env?: Record<string, string | undefined>): string | null
export function stackLine(stack: string, offset: number): number | null
export function runGo(req: { pack: Pack; code: string; mode: 'run' | 'submit' }, o?: { home?: string; env?: Record<string, string | undefined>; limits?: Limits; log?: (msg: string) => void; signal?: AbortSignal; allowRawImports?: boolean }): Promise<RunResult>
export function trimCache(cache: string, limits?: Limits, log?: (msg: string) => void, now?: number): Promise<boolean>
export function groupRssBytes(pid: number): Promise<number>
export function watchGroupRss(o: { pid: number; capBytes: number; pollMs: number; onOver: (bytes: number) => void; onSample?: (bytes: number) => void }): () => void
export function removeTree(dir: string, log?: (msg: string) => void): Promise<boolean>
export function sweepStaleRunDirs(dir?: string, maxAgeMs?: number, log?: (msg: string) => void, o?: { shutdown?: boolean; selfPid?: number }): Promise<number>
export function runOfProcess(command: string, root: string): string | null
export function reapGroup(pgid: number, ms?: number): Promise<boolean>
export interface Runner { packs: Map<string, Pack>; readonly busy: boolean; claim(): boolean; run(req: { pack: Pack; code: string; mode: 'run' | 'submit' }, o?: { signal?: AbortSignal }): Promise<RunResult>; abort(): void; sweep(o?: { shutdown?: boolean }): Promise<number>; settled(): Promise<void> }
export function createRunner(o?: { home?: string; env?: Record<string, string | undefined>; limits?: Limits; packsDir?: string; log?: (msg: string) => void; allowRawImports?: boolean }): Runner

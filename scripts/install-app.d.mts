export const APP_ROOT: string
export const APP_ID: string
export function iconPng(size?: number): Buffer
export function makeIcns(outFile: string): void
export function viteBuild(outDir: string, o?: { desktop?: boolean }): void
export function desktopConfig(o: { out: string; icon?: string | null }): Record<string, unknown>
export function stageApp(stage: string, o?: { build?: boolean; dist?: string | null; builder?: (outDir: string) => void }): string
export function buildDesktopApp(o?: { build?: boolean; dist?: string | null; icon?: boolean; log?: (m: string) => void }): Promise<{ app: string; work: string }>
export function swapApp(built: string, dest: string): string
export function finishBundle(app: string, home: string | null): void
export function installDesktopApp(o: { dest: string; home: string; build?: boolean; dist?: string | null; icon?: boolean; log?: (m: string) => void }): Promise<string>
export function parseArgs(argv: string[], env?: Record<string, string | undefined>): { dest: string; home: string; build: boolean; dist: string | null; icon: boolean }
export const FULL_SCREEN_DEFAULT_ARGS: string[]
export function setFullScreenDefault(run?: (cmd: string, args: string[], o?: object) => unknown): boolean

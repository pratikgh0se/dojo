import type { ExportKind, PortfolioLab } from './export.mjs'
import type { GhDeps } from './gh.mjs'
export function sameFiles(a: unknown, b: string[]): boolean
export function publish(deps: GhDeps, a: { lab: PortfolioLab; kind: ExportKind; labsRoot: string; text?: string; files: string[] }): Promise<{ url: string; committed: boolean }>

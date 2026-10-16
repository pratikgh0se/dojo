import type { Hit } from '../../scripts/leak-scan.mjs'
export interface PortfolioLab { id: string; title: string; repo: string; path: string; tickets?: string[] }
export interface FileEntry { path: string; bytes: number }
export type ExportKind = 'repo' | 'site' | 'article'
export interface BuiltExport { stage: string; files: FileEntry[]; publishFiles: string[]; writeup: string; uncommitted: boolean; hits: Hit[]; dispose(): void }
export const SITE_REPO: string
export const PUBLISH_DIR: string
export function excluded(rel: string): boolean
export function clonePath(labsRoot: string, kind: ExportKind, lab: PortfolioLab): string
export function pagePath(kind: 'site' | 'article', lab: PortfolioLab): string
export function indexEntry(kind: ExportKind, lab: PortfolioLab): { target: string; line: string }
export function targetRepoName(kind: ExportKind, lab: PortfolioLab): string
export function addIndexLine(readme: string | undefined, o: { repo: string; kind: ExportKind; lab: PortfolioLab }): string
export function ownUrlAllow(user: string): RegExp[]
export function targetUrls(a: { kind: ExportKind; lab: PortfolioLab; user: string }): { urls: string[]; repoUrl: string }
export function buildExport(a: { lab: PortfolioLab; labsRoot: string; kind?: ExportKind; text?: string; user?: string | null; extraTerms?: string[]; tmp?: string }): Promise<BuiltExport>

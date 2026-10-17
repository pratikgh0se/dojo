import type { GhDeps } from './gh.mjs'
export type PagesResult = { state: 'on' | 'enabled'; siteUrl: string } | { state: 'failed'; detail: string }
export function ensurePages(deps: GhDeps, a: { user: string; repo: string }): Promise<PagesResult>

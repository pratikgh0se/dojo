// Client of POST /portfolio/export and /portfolio/publish (writer token only). Never throws: every failure resolves to
// { ok: false, code, message }. The lab's title and ticket list come with the export, so there is one call to read the lab.
import { READ_ONLY_MESSAGE, writerHeaders } from './writer'

export type PublishKind = 'repo' | 'site' | 'article'
export interface FileEntry { path: string; bytes: number }
export interface LeakHit { file: string; line: number; rule: string; text: string }
export type GhStatus = { ok: true; user: string } | { ok: false; code: string; message: string }
export interface ExportInfo {
  title: string
  /** the target repository's name (`ai-platform-lab` or `ai-infra-portfolio`); the owner is `gh.user` */
  repo: string
  /** the lab's ticket ids, in the order of its definition */
  tickets: string[]
  /** repo: the lab folder's files at HEAD (paths relative to the lab folder, README.md as drafted); site, article: the one page */
  files: FileEntry[]
  /** what a publish writes in the target repo (repo-relative, sorted, the root README.md index included): the confirm screen's list */
  publishFiles: string[]
  /** WRITEUP.md at HEAD ('' for a page) */
  writeup: string
  uncommitted: boolean
  hits: LeakHit[]
  urls: string[]
  repoUrl: string | null
  gh: GhStatus
}
/** What GitHub Pages came to after a site or article publish (R3): already on, turned on now, or refused (`detail` is GitHub's own words). Never stored. */
export type PagesInfo = { state: 'on' | 'enabled'; siteUrl: string } | { state: 'failed'; detail: string }
export interface PublishInfo { url: string; pages?: PagesInfo }
export type Outcome<T> = { ok: true; value: T } | { ok: false; code: string; message: string; hits?: LeakHit[] }

export const NO_SERVER_MESSAGE = 'Publishing needs the Dojo server. Open Dojo from the Dojo app.'

type Fetch = typeof fetch
const defaultFetch: Fetch = (i, n) => globalThis.fetch(i, n)

async function post<T>(path: string, body: unknown, f: Fetch): Promise<Outcome<T>> {
  let res: Response
  try {
    res = await f(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...writerHeaders() }, body: JSON.stringify(body) })
  } catch {
    return { ok: false, code: 'no_server', message: NO_SERVER_MESSAGE }
  }
  let json: Record<string, unknown> | null = null
  try { json = (await res.json()) as Record<string, unknown> } catch { json = null }
  if (json && json.ok === true) {
    const value = { ...json }
    delete value.ok
    return { ok: true, value: value as T }
  }
  const err = json?.error as { code?: unknown; message?: unknown; hits?: unknown } | undefined
  const code = typeof err?.code === 'string' ? err.code : `http_${res.status}`
  if (res.status === 403 && code === 'not_writer') return { ok: false, code, message: READ_ONLY_MESSAGE }
  if (res.status === 404 && !json) return { ok: false, code: 'no_server', message: NO_SERVER_MESSAGE }
  const message = typeof err?.message === 'string' ? err.message : `The request failed (HTTP ${res.status}).`
  const hits = Array.isArray(err?.hits) ? (err.hits as LeakHit[]) : undefined
  return { ok: false, code, message, ...(hits ? { hits } : {}) }
}

/** `login: false` skips the GitHub login (no gh call): only the site draft and the confirm screen need it. */
export const exportLab = (req: { labId: string; labsRoot: string; kind?: PublishKind; text?: string; login?: boolean }, f: Fetch = defaultFetch) =>
  post<ExportInfo>('/portfolio/export', req, f)

export const publishLab = (req: { labId: string; labsRoot: string; kind: PublishKind; text?: string; files: string[] }, f: Fetch = defaultFetch) =>
  post<PublishInfo>('/portfolio/publish', req, f)

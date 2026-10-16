// POST /portfolio/export and POST /portfolio/publish (portfolio.md). The HTTP prelude (origin, method, type, size, writer token) is
// writerRoute in dojo-server.mjs; this module takes the parsed JSON body and answers { status, body }.
//   export   { labId, labsRoot, kind? = 'repo', text? }
//            -> { ok, title, repo, tickets, files: [{path, bytes}], publishFiles: [path], writeup, uncommitted, hits, urls, repoUrl, gh }
//   publish  { labId, labsRoot, kind, text?, files: [path] } -> { ok, url, committed }
// Errors are { ok: false, error: { code, message, hits? } }. Every path is derived from the lab definition and the resolved labs root.
import { buildExport, targetRepoName, targetUrls } from './export.mjs'
import { ghLogin } from './gh.mjs'
import { publish } from './publish.mjs'
import { PortfolioError } from './util.mjs'

export const MAX_BODY_BYTES = 512 * 1024
export const MAX_TEXT_CHARS = 200_000
const MAX_FILES = 5000
const KINDS = ['repo', 'site', 'article']
/** HTTP status of each error code (portfolio and lab codes that the routes can raise). */
export const PORTFOLIO_STATUS = {
  bad_request: 400, bad_root: 400, unknown_lab: 404, not_set_up: 409, files_mismatch: 409, busy: 429, leak_found: 422,
  gh_not_logged_in: 401, gh_missing: 503, gh_failed: 502, push_failed: 502, git_missing: 503,
}
const bad = message => new PortfolioError('bad_request', message)

/** `loadLab(id)` returns the lab definition (or throws unknown_lab); `resolveRoot(raw)` the absolute labs root (or throws bad_root). */
export function createPortfolio({ loadLab, resolveRoot, env = process.env }) {
  const deps = { env, ghBin: env.DOJO_GH_BIN || 'gh', extraTerms: String(env.DOJO_LEAK_EXTRA_TERMS ?? '').split(',').map(t => t.trim()).filter(Boolean) }

  async function parse(body, publishing) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('body must be a JSON object')
    if (typeof body.labId !== 'string' || !/^[a-z0-9-]+$/.test(body.labId)) throw new PortfolioError('unknown_lab', 'This lab is not available in this copy of Dojo.')
    if (publishing && body.kind === undefined) throw bad('kind is required')
    const kind = body.kind ?? 'repo'
    if (!KINDS.includes(kind)) throw bad('kind must be repo, site or article')
    const text = body.text
    if (text !== undefined && (typeof text !== 'string' || text.length > MAX_TEXT_CHARS)) throw bad(`text must be a string of at most ${MAX_TEXT_CHARS} characters`)
    if (typeof body.labsRoot !== 'string') throw new PortfolioError('bad_root', 'The labs folder must be inside your home folder, and not the home folder itself.')
    const lab = await loadLab(body.labId)
    const labsRoot = await resolveRoot(body.labsRoot)
    return { lab, labsRoot, kind, text }
  }

  async function doExport(raw) {
    const { lab, labsRoot, kind, text } = await parse(raw, false)
    let user = null
    let gh
    if (raw?.login === false) {
      // A repo, article or LinkedIn draft needs no GitHub login (PORT-20 Given: the stub log is still empty after the draft): no gh call.
      gh = { ok: false, code: 'gh_not_checked', message: 'The GitHub login was not checked.' }
    } else {
      try {
        user = await ghLogin(deps)
        gh = { ok: true, user }
      } catch (e) {
        if (!(e instanceof PortfolioError) || !e.code.startsWith('gh_')) throw e
        gh = { ok: false, code: e.code, message: e.message }
      }
    }
    const b = await buildExport({ lab, labsRoot, kind, text, user, extraTerms: deps.extraTerms })
    try {
      const t = user ? targetUrls({ kind, lab, user }) : { urls: [], repoUrl: null }
      return {
        title: lab.title, repo: targetRepoName(kind, lab), tickets: [...lab.tickets], files: b.files, publishFiles: b.publishFiles, writeup: b.writeup,
        uncommitted: b.uncommitted, hits: b.hits, urls: t.urls, repoUrl: t.repoUrl, gh,
      }
    } finally {
      b.dispose()
    }
  }

  async function doPublish(raw) {
    const { lab, labsRoot, kind, text } = await parse(raw, true)
    if (kind !== 'repo' && (typeof text !== 'string' || text.trim() === '')) throw bad('text is required for a page')
    const files = raw.files
    if (!Array.isArray(files) || files.length > MAX_FILES || !files.every(f => typeof f === 'string')) throw bad('files must be the list of paths from the confirm screen')
    return publish(deps, { lab, kind, labsRoot, text, files })
  }

  return {
    async handle(path, body) {
      try {
        if (path !== '/portfolio/export' && path !== '/portfolio/publish') return { status: 404, body: { ok: false, error: { code: 'unknown_route', message: `no route ${path}` } } }
        const out = path === '/portfolio/export' ? await doExport(body) : await doPublish(body)
        return { status: 200, body: { ok: true, ...out } }
      } catch (e) {
        const code = typeof e?.code === 'string' ? e.code : null
        if (code && code in PORTFOLIO_STATUS) return { status: PORTFOLIO_STATUS[code], body: { ok: false, error: { code, message: e.message, ...(e.hits ? { hits: e.hits } : {}) } } }
        return { status: 500, unexpected: e, body: { ok: false, error: { code: 'server_error', message: 'Something went wrong while handling that request.' } } }
      }
    },
  }
}

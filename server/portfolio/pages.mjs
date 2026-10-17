// GitHub Pages for the portfolio site repo (portfolio.md PORT-54 to PORT-60). After a site or article push: read Pages; if it is off,
// turn it on (branch main, folder /). Two `gh api` calls, no retry, no loop. A failure here never undoes the push; it is returned, not thrown.
import { gh } from './gh.mjs'
import { tail } from './util.mjs'

/**
 * deps = { env, ghBin }. Resolves { state: 'on' | 'enabled', siteUrl } or { state: 'failed', detail } (detail is GitHub's own message).
 * 'on': the read worked. 'enabled': the read failed (Pages off) and the write worked.
 */
export async function ensurePages(deps, { user, repo }) {
  const base = `repos/${user}/${repo}/pages`
  const siteUrl = `https://${user}.github.io/${repo}/`
  const read = await gh(deps, ['api', base], { timeoutMs: 30_000 })
  if (read.status === 0) return { state: 'on', siteUrl }
  const write = await gh(deps, ['api', '-X', 'POST', base, '-f', 'source[branch]=main', '-f', 'source[path]=/'], { timeoutMs: 30_000 })
  if (write.status === 0) return { state: 'enabled', siteUrl }
  return { state: 'failed', detail: tail(write.stderr || write.stdout || write.error?.message, 400).replace(/^gh: /, '') }
}

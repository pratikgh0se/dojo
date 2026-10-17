// Publishes through gh and plain git, in a clone of its own (<labsRoot>/.publish/<repo>), never in the learner's working repo.
// Never forced, never pulled, never merged: a rejected push is push_failed and the learner decides what to do with the clone.
// Nothing partial goes out: the file list is rebuilt here and must equal the one the learner confirmed, the leak scan runs again, and
// the commit is checked against the list before the push. Node standard library only.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { addIndexLine, buildExport, clonePath, pagePath, targetRepoName, targetUrls } from './export.mjs'
import { gh, ghLogin } from './gh.mjs'
import { ensurePages } from './pages.mjs'
import { PortfolioError, git, tail } from './util.mjs'

let inFlight = false

const SUBJECT = { repo: lab => `Add lab ${lab.id}`, site: lab => `Add page for ${lab.id}`, article: lab => `Add article for ${lab.id}` }

/** The confirmed list and the rebuilt one hold the same paths. */
export function sameFiles(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.every(x => typeof x === 'string') || a.length !== b.length) return false
  const sa = new Set(a)
  return sa.size === a.length && b.every(p => sa.has(p))
}

/** The publish clone of `repoName`: an existing one is used as it is; otherwise `gh repo create` (only when the repository is missing) and `gh repo clone`. */
async function ensureClone(deps, { user, repoName, dir }) {
  if (existsSync(join(dir, '.git'))) return
  const slug = `${user}/${repoName}`
  mkdirSync(dirname(dir), { recursive: true })
  const view = await gh(deps, ['repo', 'view', slug], { timeoutMs: 60_000 })
  if (view.status !== 0) {
    const made = await gh(deps, ['repo', 'create', slug, '--public'])
    if (made.status !== 0) throw new PortfolioError('gh_failed', `The GitHub CLI could not create ${slug}: ${tail(made.stderr || made.stdout)}`)
  }
  const c = await gh(deps, ['repo', 'clone', slug, dir])
  if (c.status !== 0) throw new PortfolioError('gh_failed', `The GitHub CLI could not clone ${slug}: ${tail(c.stderr || c.stdout)}`)
  // a repository with no commit yet: the first commit goes on main
  if ((await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'], { env: deps.env })).status !== 0) await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'], { env: deps.env })
}

/** Copies the staged files into the clone and adds the index line to its root README.md. */
function place({ clone, kind, lab, stage }) {
  if (kind === 'repo') {
    const dest = join(clone, 'labs', lab.id)
    rmSync(dest, { recursive: true, force: true }) // the folder is replaced as a whole: a file dropped from the lab leaves the public copy too
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(join(stage, 'labs', lab.id), dest, { recursive: true })
  } else {
    const rel = pagePath(kind, lab)
    mkdirSync(dirname(join(clone, rel)), { recursive: true })
    cpSync(join(stage, rel), join(clone, rel))
  }
  const index = join(clone, 'README.md')
  writeFileSync(index, addIndexLine(existsSync(index) ? readFileSync(index, 'utf8') : '', { repo: targetRepoName(kind, lab), kind, lab }))
}

/**
 * deps = { env, ghBin, extraTerms }. `files` is the list of repo-relative paths the confirm screen showed; the export is rebuilt here
 * and must equal it. Throws PortfolioError: gh_missing, gh_not_logged_in, gh_failed, not_set_up, bad_request, leak_found (with .hits),
 * files_mismatch, push_failed, busy. Resolves { url, committed, pages? }; pages (site, article only) is ensurePages' result.
 */
export async function publish(deps, { lab, kind, labsRoot, text, files }) {
  if (inFlight) throw new PortfolioError('busy', 'A publish is already running. Wait for it to finish.')
  inFlight = true
  let built = null
  try {
    const user = await ghLogin(deps)
    built = await buildExport({ lab, labsRoot, kind, text, user, extraTerms: deps.extraTerms })
    if (built.hits.length > 0) throw new PortfolioError('leak_found', 'Something in the files should not go public. Fix it, commit it, and publish again.', { hits: built.hits })
    if (built.publishFiles.length === 0) throw new PortfolioError('bad_request', 'There is nothing to publish.')
    if (!sameFiles(files, built.publishFiles)) throw new PortfolioError('files_mismatch', 'The files changed since you looked at the list. Close this and open it again.')

    const dir = clonePath(labsRoot, kind, lab)
    await ensureClone(deps, { user, repoName: targetRepoName(kind, lab), dir })
    const dirty = await git(dir, ['status', '--porcelain'], { env: deps.env })
    if (dirty.status !== 0 || dirty.stdout.trim() !== '') throw new PortfolioError('gh_failed', `The publish folder ${dir} has leftover changes. Delete that folder and publish again.`)
    place({ clone: dir, kind, lab, stage: built.stage })

    await git(dir, ['add', '-A'], { env: deps.env })
    const staged = await git(dir, ['diff', '--cached', '--name-only', '-z'], { env: deps.env })
    const changed = String(staged.stdout).split('\0').filter(Boolean)
    // the commit may hold nothing that is not on the confirmed list
    const extra = changed.filter(p => !built.publishFiles.includes(p))
    if (extra.length > 0) throw new PortfolioError('gh_failed', `The commit would hold files that are not on the list (${extra.slice(0, 3).join(', ')}). Nothing was pushed. Delete ${dir} and publish again.`)
    let committed = false
    if (changed.length > 0) {
      const name = String((await git(dir, ['config', 'user.name'], { env: deps.env })).stdout).trim() || user
      const c = await git(dir, ['-c', `user.name=${name}`, '-c', `user.email=${user}@users.noreply.github.com`, '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-q', '-m', SUBJECT[kind](lab)], { env: deps.env })
      if (c.status !== 0) throw new PortfolioError('gh_failed', `git commit failed: ${tail(c.stderr || c.stdout)}`)
      committed = true
    }
    const push = await git(dir, ['push', 'origin', 'main'], { env: deps.env, timeoutMs: 120_000 })
    if (push.status !== 0) {
      throw new PortfolioError('push_failed', `GitHub did not accept the push: ${tail(push.stderr || push.stdout, 1200)}\nDojo never pulls, merges or forces. Fix it in ${dir}, or delete that folder and publish again.`)
    }
    // Pages comes after the push and only for a site or article; its failure is a result, never an error: the push stays (PORT-56, PORT-57)
    const pages = kind === 'repo' ? undefined : await ensurePages(deps, { user, repo: targetRepoName(kind, lab) })
    return { url: targetUrls({ kind, lab, user }).urls[0], committed, ...(pages ? { pages } : {}) }
  } finally {
    built?.dispose()
    inFlight = false
  }
}

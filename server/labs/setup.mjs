// Set up lab: create the learner's lab folder from the template, in a git repo, with one baseline commit. Node standard library only.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { git, identityArgs, LabError } from './common.mjs'

const BASELINE = def => `baseline: ${def.id} template v${def.version}`

/** The commit that set the lab up (the newest baseline touching the lab path), or null when there is none. */
export async function findBaseline(def, repoDir, env) {
  if (!existsSync(join(repoDir, '.git'))) return null
  const r = await git(['log', '-1', '--format=%H', '--grep', `^baseline: ${def.id} template v`, '--', def.path], { cwd: repoDir, env })
  return r.code === 0 && /^[0-9a-f]{40}$/.test(r.stdout.trim()) ? r.stdout.trim() : null
}

/** HEAD of the lab repo, or null when it has no commit. */
async function headOf(repoDir, env) {
  const r = await git(['rev-parse', '--verify', '-q', 'HEAD'], { cwd: repoDir, env })
  return r.code === 0 ? r.stdout.trim() : null
}

/**
 * <labsRoot>/<repo>/<path>. An existing folder is left alone ('exists'; its baseCommit is the baseline commit when there is one, else
 * the repo's HEAD, else null). Otherwise: git init the repo if it is not one, copy
 * template/, and commit only that path (other uncommitted work in the repo is neither touched nor committed).
 * @returns {Promise<{status: 'created' | 'exists', path: string, baseCommit: string | null}>}
 */
export async function setupLab(def, labsRoot, env) {
  const repoDir = join(labsRoot, def.repo)
  const target = join(repoDir, def.path)
  if (existsSync(target)) return { status: 'exists', path: target, baseCommit: (await findBaseline(def, repoDir, env)) ?? (existsSync(join(repoDir, '.git')) ? await headOf(repoDir, env) : null) }
  mkdirSync(repoDir, { recursive: true })
  if (!existsSync(join(repoDir, '.git'))) {
    const init = await git(['init', '-q'], { cwd: repoDir, env })
    if (init.code !== 0) throw new LabError('git_failed', `git init failed: ${init.stderr.trim()}`)
  }
  mkdirSync(dirname(target), { recursive: true })
  cpSync(join(def.dir, 'template'), target, { recursive: true })
  try {
    const add = await git(['add', '--', def.path], { cwd: repoDir, env })
    if (add.code !== 0) throw new LabError('git_failed', `git add failed: ${add.stderr.trim()}`)
    // no hooks and no signing: the baseline is bookkeeping, and a signing prompt or a lint hook must not stop it. --allow-empty:
    // a folder deleted and set up again can match what the repo already holds, and still gets its new baseline.
    const commit = await git([...(await identityArgs(repoDir, env)), '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '--allow-empty', '-m', BASELINE(def), '--', def.path], { cwd: repoDir, env })
    if (commit.code !== 0) throw new LabError('git_failed', `git commit failed: ${(commit.stderr || commit.stdout).trim()}`)
  } catch (e) {
    rmSync(target, { recursive: true, force: true }) // a half-made folder would read as 'exists' on the next try
    throw e
  }
  const head = await git(['rev-parse', 'HEAD'], { cwd: repoDir, env })
  return { status: 'created', path: target, baseCommit: head.stdout.trim() }
}

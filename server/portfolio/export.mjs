// The file set a publish would write (portfolio.md, "Exported files" and "Publish file list"), built from the learner's committed lab
// folder at git HEAD, never from the working tree. Everything goes into a staging dir laid out as the target repository will be, is
// scanned with scripts/leak-scan.mjs by its publish path, and is copied from there by publish.mjs. Node standard library only.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { scanTree } from '../../scripts/leak-scan.mjs'
import { PortfolioError, git } from './util.mjs'

export const SITE_REPO = 'ai-infra-portfolio'
export const PUBLISH_DIR = '.publish'
const MAX_WRITEUP = 100 * 1024
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const LAB_ID = /^[a-z0-9-]+$/
const CACHE_DIRS = new Set(['__pycache__', '.pytest_cache', '.mypy_cache'])
const ENV_DIRS = new Set(['.venv', 'venv', 'env'])

/**
 * Paths (relative to the lab folder) that never leave: anything under .dojo/, caches, bytecode, virtual environments, and at the top
 * lab.json and reference/ (the definition's own files).
 */
export function excluded(rel) {
  const parts = rel.split('/')
  const name = parts[parts.length - 1]
  if (parts.length === 1 && name === 'lab.json') return true
  if (parts.length > 1 && parts[0] === 'reference') return true
  if (parts.slice(0, -1).some(p => p === '.dojo' || CACHE_DIRS.has(p) || ENV_DIRS.has(p))) return true
  return name.endsWith('.pyc')
}

export const clonePath = (labsRoot, kind, lab) => join(labsRoot, PUBLISH_DIR, kind === 'repo' ? lab.repo : SITE_REPO)

/** The page a site or article output writes, repo-relative: the article is named by the lab id. */
export const pagePath = (kind, lab) => (kind === 'site' ? `labs/${lab.id}.md` : `writing/${lab.id}.md`)

/** What an index line links to, and the line itself (portfolio.md, "Root index"). */
export function indexEntry(kind, lab) {
  if (kind === 'repo') return { target: `labs/${lab.id}`, line: `- [${lab.title}](labs/${lab.id})` }
  const rel = pagePath(kind, lab)
  return { target: rel, line: `- [${kind === 'article' ? `${lab.title} (article)` : lab.title}](${rel})` }
}

export const targetRepoName = (kind, lab) => (kind === 'repo' ? lab.repo : SITE_REPO)
const SENTENCE = { repo: 'Labs built and proven while learning AI infrastructure, each with checks that pass.', page: 'Write-ups and articles about labs built while learning AI infrastructure.' }

/**
 * The root README.md of a target repo after one more publish: created as `# <repo>`, a blank line, one sentence, a blank line and the index
 * lines; an existing one keeps its text and the index line is appended after a blank line (straight after another index line). The line
 * of a lab that is already listed is replaced, never repeated.
 */
export function addIndexLine(readme, { repo, kind, lab }) {
  const { target, line } = indexEntry(kind, lab)
  const text = String(readme ?? '')
  if (text.trim() === '') return `# ${repo}\n\n${kind === 'repo' ? SENTENCE.repo : SENTENCE.page}\n\n${line}\n`
  const lines = text.replace(/\s+$/, '').split('\n')
  const same = lines.findIndex(l => l.startsWith('- [') && l.includes(`](${target})`))
  if (same >= 0) { lines[same] = line; return `${lines.join('\n')}\n` }
  const last = lines[lines.length - 1]
  return `${lines.join('\n')}\n${last.startsWith('- [') ? '' : '\n'}${line}\n`
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** The learner's own public URLs. The term lists may name their handle, so these are removed from a line before the term rules look at it. */
export const ownUrlAllow = user => [
  new RegExp(`https://github\\.com/${esc(user)}(?:/[\\w./#?=&%~-]*)?`, 'gi'),
  new RegExp(`https://${esc(user)}\\.github\\.io(?:/[\\w./#?=&%~-]*)?`, 'gi'),
]

/** The exact public URL of an output, and the repo's own URL (portfolio.md, "Where the files go"). */
export function targetUrls({ kind, lab, user }) {
  const repoUrl = `https://github.com/${user}/${lab.repo}/tree/main/labs/${lab.id}`
  if (kind === 'repo') return { urls: [repoUrl], repoUrl }
  return { urls: [`https://${user}.github.io/${SITE_REPO}/${pagePath(kind, lab).replace(/\.md$/, '')}`], repoUrl }
}

function assertSafe(lab) {
  if (!LAB_ID.test(lab.id) || !SAFE.test(lab.repo) || lab.path !== `labs/${lab.id}`) throw new PortfolioError('bad_request', 'The lab definition has an unsafe name.')
}

function listFiles(root, rel = '') {
  const out = []
  for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...listFiles(root, r))
    else if (e.isFile()) out.push({ path: r, bytes: statSync(join(root, r)).size })
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

const notSetUp = () => new PortfolioError('not_set_up', 'The lab folder was not found, so set up the lab again.')

/** Writes the tracked files of <labsRoot>/<repo>/<path> at HEAD into `dest`. Returns whether the folder has uncommitted changes. */
async function stageRepo({ lab, labsRoot, dest }) {
  const repoDir = join(labsRoot, lab.repo)
  const labDir = join(repoDir, lab.path)
  if (!existsSync(join(repoDir, '.git')) || !existsSync(labDir) || !statSync(labDir).isDirectory()) throw notSetUp()
  if ((await git(repoDir, ['rev-parse', '--verify', '-q', 'HEAD'])).status !== 0) throw notSetUp()
  const ls = await git(repoDir, ['ls-tree', '-r', '-z', 'HEAD', '--', lab.path])
  if (ls.status !== 0) throw notSetUp()
  const prefix = `${lab.path}/`
  let staged = 0
  for (const entry of ls.stdout.split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t')
    const [mode, type, sha] = entry.slice(0, tab).split(' ')
    const path = entry.slice(tab + 1)
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755') || !path.startsWith(prefix)) continue // a symlink or submodule never goes out
    const rel = path.slice(prefix.length)
    if (excluded(rel) || rel.split('/').includes('..')) continue
    const blob = await git(repoDir, ['cat-file', 'blob', sha], { buffer: true })
    if (blob.status !== 0) throw notSetUp()
    const file = join(dest, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, blob.stdout, { mode: mode === '100755' ? 0o755 : 0o644 })
    staged += 1
  }
  if (staged === 0) throw notSetUp()
  const st = await git(repoDir, ['status', '--porcelain', '--', lab.path])
  return st.stdout.trim() !== ''
}

/**
 * kind 'repo': the lab folder at HEAD, its README.md replaced by `text` when given. kind 'site' | 'article': the one page `text`.
 * `user` (the GitHub login, when known) lets the learner's own URLs through the term rule. The caller disposes the staging dir.
 * Returns { stage, files, publishFiles, writeup, uncommitted, hits, dispose }:
 *   files         [{ path, bytes }]: the lab folder's files (repo, relative to the lab folder) or the one page (repo-relative)
 *   publishFiles  every path the publish writes in the target repo, sorted, the root README.md index included (what the confirm screen lists)
 *   stage         the target repo's layout of those files; its README.md is the index as a first publish would write it (scan only)
 */
export async function buildExport({ lab, labsRoot, kind = 'repo', text, user = null, extraTerms = [], tmp = tmpdir() }) {
  assertSafe(lab)
  const stage = mkdtempSync(join(tmp, 'dojo-export-'))
  const dispose = () => rmSync(stage, { recursive: true, force: true })
  try {
    let uncommitted = false
    let files = []
    let writeup = ''
    if (kind === 'repo') {
      const dest = join(stage, 'labs', lab.id)
      mkdirSync(dest, { recursive: true })
      uncommitted = await stageRepo({ lab, labsRoot, dest })
      if (typeof text === 'string') writeFileSync(join(dest, 'README.md'), text)
      files = listFiles(dest)
      const w = join(dest, 'WRITEUP.md')
      writeup = existsSync(w) ? readFileSync(w, 'utf8').slice(0, MAX_WRITEUP) : ''
    } else if (typeof text === 'string' && text.trim() !== '') {
      const rel = pagePath(kind, lab)
      mkdirSync(dirname(join(stage, rel)), { recursive: true })
      writeFileSync(join(stage, rel), text)
      files = [{ path: rel, bytes: Buffer.byteLength(text) }]
    }
    if (files.length > 0) writeFileSync(join(stage, 'README.md'), addIndexLine('', { repo: targetRepoName(kind, lab), kind, lab }))
    const publishFiles = listFiles(stage).map(f => f.path)
    return {
      stage, dispose, uncommitted, files, publishFiles, writeup,
      hits: scanTree(stage, { allow: user ? ownUrlAllow(user) : [], extraTerms }),
    }
  } catch (e) {
    dispose()
    throw e
  }
}

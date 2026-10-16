// Review bundle: the curated, size-capped input of the lab_review job, built from COMMITTED work only.
//   { rubric: [{id, text}], writeup: string, files: [{ path, diff } | { path, note }] }
// `path` is relative to the lab folder. A file that is withheld or did not fit is { path, note } (no diff). The latest check
// results are not here: the app has them (it stores the runs) and adds them to the job context.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, LAB_MESSAGES, LabError } from './common.mjs'
import { looksLikeSecret } from '../../scripts/leak-scan.mjs'
import { findBaseline } from './setup.mjs'

/** writeup and diffs are raw UTF-8 bytes; totalBytes is the whole bundle as JSON (the helper's request body cap is 64 KiB). */
export const BUNDLE_LIMITS = { writeupBytes: 8192, diffBytes: 40960, fileBytes: 100 * 1024, totalBytes: 57344, maxFiles: 200 }
const SKIP_SEGMENTS = new Set(['.dojo', '.git', '.venv', 'venv', 'node_modules', '__pycache__'])
/** git's empty tree: with no baseline commit the whole lab folder reads as new work. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const CUT_MARK = '\n[WRITEUP.md was cut at 8 KiB]'

/** `text` cut to at most `max` UTF-8 bytes, never in the middle of a character. */
function cutBytes(text, max) {
  const buf = Buffer.from(text, 'utf8')
  if (buf.length <= max) return text
  return buf.subarray(0, max).toString('utf8').replace(/�+$/, '')
}

/**
 * Throws LabError('not_set_up') when the lab folder is missing, LabError('lab_dirty') when it has uncommitted changes
 * (anything outside the lab folder is ignored).
 */
export async function buildBundle(def, labsRoot, env) {
  const repoDir = join(labsRoot, def.repo)
  const dir = join(repoDir, def.path)
  if (!existsSync(dir) || !existsSync(join(repoDir, '.git'))) throw new LabError('not_set_up', LAB_MESSAGES.not_set_up)
  const base = (await findBaseline(def, repoDir, env)) ?? EMPTY_TREE
  const g = (args) => git(args, { cwd: dir, env })
  const status = await g(['status', '--porcelain', '--', '.'])
  if (status.code !== 0) throw new LabError('git_failed', `git status failed: ${status.stderr.trim()}`)
  if (status.stdout.trim() !== '') throw new LabError('lab_dirty', LAB_MESSAGES.lab_dirty)

  const stat = await g(['diff', '--numstat', '-z', '--relative', '--no-renames', base, 'HEAD', '--', '.'])
  if (stat.code !== 0) throw new LabError('git_failed', `git diff failed: ${stat.stderr.trim()}`)
  const changed = stat.stdout.split('\0').filter(Boolean).map(r => {
    const m = /^(\S+)\t(\S+)\t(.*)$/s.exec(r)
    return m ? { path: m[3], binary: m[1] === '-' } : null
  }).filter(Boolean).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const files = []
  let used = 0
  let capped = false
  for (const f of changed) {
    if (f.binary || f.path.split('/').some(s => SKIP_SEGMENTS.has(s))) continue // never part of the work
    if (capped || files.length >= BUNDLE_LIMITS.maxFiles) { files.push({ path: f.path, note: 'over the size cap' }); continue }
    const size = await g(['cat-file', '-s', `HEAD:./${f.path}`])
    if (size.code === 0 && Number(size.stdout) > BUNDLE_LIMITS.fileBytes) continue
    const d = await g(['diff', '--no-color', '--no-ext-diff', '--relative', '--no-renames', '-U3', base, 'HEAD', '--', `:(literal)${f.path}`])
    if (d.code !== 0) continue
    if (looksLikeSecret(d.stdout)) { files.push({ path: f.path, note: 'withheld: looks like a secret' }); continue }
    const bytes = Buffer.byteLength(d.stdout, 'utf8')
    if (used + bytes > BUNDLE_LIMITS.diffBytes) { capped = true; files.push({ path: f.path, note: 'over the size cap' }); continue }
    used += bytes
    files.push({ path: f.path, diff: d.stdout })
  }

  let writeup = ''
  try { writeup = readFileSync(join(dir, 'WRITEUP.md'), 'utf8') } catch { /* none */ }
  if (Buffer.byteLength(writeup, 'utf8') > BUNDLE_LIMITS.writeupBytes) writeup = cutBytes(writeup, BUNDLE_LIMITS.writeupBytes - Buffer.byteLength(CUT_MARK, 'utf8')) + CUT_MARK

  const bundle = { rubric: def.rubric.map(r => ({ id: r.id, text: r.text })), writeup, files }
  // JSON escaping can add to the raw sizes: drop the last diffs to notes until the whole bundle fits
  for (let i = bundle.files.length - 1; i >= 0 && Buffer.byteLength(JSON.stringify(bundle), 'utf8') > BUNDLE_LIMITS.totalBytes; i--) {
    if (bundle.files[i].diff !== undefined) bundle.files[i] = { path: bundle.files[i].path, note: 'over the size cap' }
  }
  return bundle
}

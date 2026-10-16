// The labs root rule, shared by the lab routes and the portfolio routes (W6): `~` expanded, absolute, and strictly inside the
// account's home folder (not the home folder itself), also after symlinks. Anything else is LabError('bad_root').
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { LAB_MESSAGES, LabError } from './common.mjs'

/** realpath of p, or of its deepest existing ancestor plus the rest (for a folder that does not exist yet). */
export function realOr(p) {
  const abs = resolve(p)
  try { return realpathSync(abs) } catch { /* not there yet */ }
  const parent = dirname(abs)
  return parent === abs ? abs : join(realOr(parent), basename(abs))
}

/**
 * The absolute labs root for what the learner typed (`~/labs`). The home folder is env.HOME (tests point it at a scratch folder),
 * else the OS home. Throws LabError('bad_root') for a relative path, the home folder itself, anything outside it, or nothing.
 */
export function resolveLabsRoot(labsRoot, env = process.env) {
  const bad = () => new LabError('bad_root', LAB_MESSAGES.bad_root)
  if (typeof labsRoot !== 'string' || labsRoot.trim() === '') throw bad()
  const home = env.HOME || homedir()
  const t = labsRoot.trim()
  const expanded = t === '~' ? home : t.startsWith('~/') ? join(home, t.slice(2)) : t
  if (!isAbsolute(expanded)) throw bad()
  const root = resolve(expanded)
  const fold = p => (process.platform === 'darwin' ? p.toLowerCase() : p) // APFS is case-insensitive by default
  const r = fold(realOr(root)), h = fold(realOr(home))
  if (r === h || !r.startsWith(h + sep)) throw bad()
  return root
}

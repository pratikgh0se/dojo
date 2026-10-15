// File-identity checks: two paths are the same place when stat() gives the same dev+ino, however they are spelled.
// Catches aliases that lstat/readlink/realpath never report (macOS firmlinks such as /System/Volumes/Data/Users/..., /.vol, case or Unicode-normalisation quirks).
// Only stat metadata is read; nothing is opened or listed.
import { statSync } from 'node:fs'
import { dirname } from 'node:path'

/** "dev:ino" of an existing path (symlinks followed), or null when it does not exist or cannot be statted. */
export function identityOf(p) {
  try { const s = statSync(p, { bigint: true }); return `${s.dev}:${s.ino}` } catch { return null }
}

/** Returns check(path): the first existing ancestor (or the path itself) sharing an identity with one of `roots`, else null. Roots that do not exist protect nothing. */
export function identityGuard(roots) {
  const ids = new Set(roots.map(identityOf).filter(Boolean))
  return p => {
    if (ids.size === 0) return null
    for (let cur = p; ; cur = dirname(cur)) {
      const id = identityOf(cur)
      if (id && ids.has(id)) return cur
      if (dirname(cur) === cur) return null
    }
  }
}

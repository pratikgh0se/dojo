import { useEffect, useState } from 'react'

/** Where the disk server keeps the data (GET /db/health: `home`, `dbPath`, the user's own `userHome`) and the learner's project repo (G6, or null). */
export interface DataHome { home: string; dbPath: string; userHome?: string; projectRepo?: string | null }

/** The SQLite file: the server's own dbPath, else <home>/dojo.db. */
export function dataFile(h: DataHome): string {
  return h.dbPath || `${h.home.replace(/\/+$/, '')}/dojo.db`
}

/**
 * Ruling 23 K5: a path inside the user's home reads "~/Dojo/dojo.db", not "/Users/<name>/Dojo/dojo.db". `userHome` is the
 * server's; without it (an older server) a macOS or Linux home directory is recognised by its shape. A path outside the
 * home (a DOJO_HOME elsewhere) stays as it is.
 */
export function homeRelative(path: string, userHome?: string): string {
  const home = userHome ? userHome.replace(/\/+$/, '') : /^\/(?:Users|home)\/[^/]+/.exec(path)?.[0] ?? ''
  if (home.length < 2 || !(path === home || path.startsWith(`${home}/`))) return path
  return `~${path.slice(home.length)}`
}

/** The data file as Settings and Backups show it. */
export function shownDataFile(h: DataHome): string {
  return homeRelative(dataFile(h), h.userHome)
}

export async function fetchDataHome(f: typeof fetch = (i, n) => globalThis.fetch(i, n)): Promise<DataHome | null> {
  try {
    const res = await f('/db/health')
    if (!res.ok) return null
    const j = (await res.json()) as { home?: unknown; dbPath?: unknown; userHome?: unknown; projectRepo?: unknown }
    const home = typeof j.home === 'string' ? j.home : ''
    const dbPath = typeof j.dbPath === 'string' ? j.dbPath : ''
    const userHome = typeof j.userHome === 'string' && j.userHome ? j.userHome : undefined
    const projectRepo = typeof j.projectRepo === 'string' && j.projectRepo !== '' ? j.projectRepo : null
    return home || dbPath ? { home, dbPath, projectRepo, ...(userHome ? { userHome } : {}) } : null
  } catch {
    return null
  }
}

/** Controller ruling 3 (8): Settings shows the real data directory, never a hard-coded ~/Dojo. Null until known. */
export function useDataHome(enabled: boolean, f?: typeof fetch): DataHome | null {
  const [h, setH] = useState<DataHome | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void fetchDataHome(f).then(r => { if (live) setH(r) })
    return () => { live = false }
  }, [enabled, f])
  return h
}

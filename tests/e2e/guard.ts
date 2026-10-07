import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

const real = (p: string): string => {
  try { return realpathSync(p) } catch { return resolve(p) }
}

/** C3: throws when a dev/test server's database lives under the real ~/Dojo (symlinks resolved). */
export function assertNotRealDojo(dbPath: string, home = homedir()): void {
  const dojo = real(join(home, 'Dojo'))
  const fold = (p: string) => (process.platform === 'darwin' ? p.toLowerCase() : p) // APFS: ~/DOJO is ~/Dojo
  const dir = fold(real(resolve(dbPath, '..')))
  if (dir === fold(dojo) || dir.startsWith(fold(dojo) + sep)) {
    throw new Error(`refusing to test against the real ~/Dojo (the server's dbPath is ${dbPath})`)
  }
}

/** Asks a running server for its dbPath; unreachable or non-Dojo servers pass (nothing to protect). */
export async function checkServerNotRealDojo(baseUrl: string): Promise<void> {
  let dbPath: unknown
  try {
    const res = await fetch(`${baseUrl}/db/health`, { signal: AbortSignal.timeout(2000) })
    dbPath = res.ok ? ((await res.json()) as { dbPath?: unknown }).dbPath : undefined
  } catch {
    return
  }
  if (typeof dbPath === 'string') assertNotRealDojo(dbPath)
}

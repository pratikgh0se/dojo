#!/usr/bin/env node
// `npm run uninstall:app`: removes the Dojo.app bundle only. Data in DOJO_HOME is never touched.
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function uninstall(dest = join(homedir(), 'Applications')) {
  const app = join(resolve(dest), 'Dojo.app')
  if (!existsSync(app)) return { removed: false, app }
  rmSync(app, { recursive: true, force: true })
  return { removed: true, app }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--dest')
  const r = uninstall(i >= 0 ? process.argv[i + 1] : undefined)
  console.log(r.removed ? `removed ${r.app} (your data in ~/Dojo is untouched)` : `nothing to remove at ${r.app}`)
}

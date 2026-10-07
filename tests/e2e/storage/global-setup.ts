import { viteBuild } from '../../../scripts/install-app.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dojoBaseUrl } from '../../../dojoPort'
import { checkServerNotRealDojo } from '../guard'

/** Builds the app once into a temp dir for the storage project's dojo-server (skipped when DOJO_E2E_DIST is set). */
export default async function globalSetup() {
  // C3: never run against a server (a reused dev server, a proxy) whose database is the real ~/Dojo.
  await checkServerNotRealDojo(dojoBaseUrl(process.env))
  if (process.env.DOJO_E2E_DIST) return
  const dir = mkdtempSync(join(tmpdir(), 'dojo-e2e-dist-'))
  // The production build the Mac app ships (npm run install:app), served by the same dojo-server the app runs
  // (harness.ts), except that the AI stays the page's fake (its test hooks), not the app's own helper routes.
  viteBuild(dir, { desktop: false })
  process.env.DOJO_E2E_DIST = dir
  return () => { rmSync(dir, { recursive: true, force: true }) }
}

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ENGINES = resolve(process.cwd(), 'public/engines')
let installed = false

/**
 * Runs the vendored algo engines inside jsdom, exactly as the browser would after
 * loadEngine(): defines <sr-algo>/<sr-algo2> and window.SRAlgo/SRAlgo2/SRAtlas.
 * jsdom has no ResizeObserver, so a no-op one is installed first.
 */
export function installAlgoEngines(): void {
  if (installed) return
  const g = globalThis as { ResizeObserver?: unknown }
  if (!g.ResizeObserver) {
    g.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }
  for (const f of ['algo.js', 'algo2.js', 'atlas-pieces.js']) {
    new Function(readFileSync(resolve(ENGINES, f), 'utf8'))()
  }
  installed = true
}

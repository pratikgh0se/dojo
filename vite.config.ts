import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { dojoPort, REAL_APP_PORT } from './dojoPort'
import { vendorPyodide } from './scripts/vendor-pyodide.mjs'
import { appCsp, CSP_REPORT_PATH, cspReportFile } from './server/csp.mjs'
import { inPyPrefix } from './server/runner/pyframe.mjs'
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

const port = dojoPort(process.env)
// Dev: the disk server (scripts/dev.mjs) owns /db, /ai and /tools. Without it (DOJO_DEV_DISK=off) there is no proxy.
const serverPort = process.env.DOJO_SERVER_PORT || 8789
if (String(serverPort) === String(REAL_APP_PORT)) {
  throw new Error(`DOJO_SERVER_PORT ${REAL_APP_PORT} is reserved for the real Dojo app (~/Dojo); dev uses 8789`)
}
const serverTarget = `http://127.0.0.1:${serverPort}`
const proxy =
  process.env.DOJO_DEV_DISK === 'off'
    ? undefined
    : { '/db': { target: serverTarget, changeOrigin: true }, '/ai': { target: serverTarget, changeOrigin: true }, '/tools': { target: serverTarget, changeOrigin: true } }

// I3: the dev server serves files from the app root, which holds the server's sources and the Go
// packs' reference solutions (server/runner/packs/<id>/ref.go). Never serve the server dir, any
// ref.go, git data, env files or keys (Vite's own defaults are repeated, since setting deny replaces them).
export const FS_DENY = ['server/**', '**/ref.go', '**/.git/**', '.env', '.env.*', '**/.env', '**/.env.*', '*.{crt,pem,key}', '**/*.{crt,pem,key}', '**/id_rsa*', '**/*.token']

const APP_ROOT = fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, '')

const normal = (p: string) => posix.normalize(decodeURIComponent(p)).toLowerCase()

/** Whether a (normalised, lower-case) path is in the server dir or is a ref.go. */
function deniedPath(path: string): boolean {
  const root = APP_ROOT.toLowerCase()
  return path === '/server' || path.startsWith('/server/') || path.startsWith(`/@fs${root}/server/`) || path.endsWith('/ref.go')
}

/**
 * I3: refuses every request for the server dir (a JS module request skips fs.deny), by URL or /@fs.
 * Security round 2 M-B: `new URL('//server/x', base)` reads "server" as a host, so a request URL that
 * starts with `//` is refused outright, leading slashes are collapsed before parsing, and the raw path
 * (before `?` or `#`) is checked as well as the parsed one.
 */
export function denyServerDir(): Plugin {
  return {
    name: 'dojo-deny-server-dir',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const raw = req.url ?? '/'
        if (raw.startsWith('//') || raw.startsWith('/\\')) {
          res.statusCode = 403
          return res.end('forbidden')
        }
        let paths: string[]
        try {
          const rawPath = raw.split(/[?#]/, 1)[0]
          const collapsed = raw.replace(/^\/+/, '/')
          paths = [normal(new URL(collapsed, 'http://x').pathname), normal(rawPath), normal(rawPath.replace(/^\/+/, '/'))]
        } catch {
          res.statusCode = 400
          return res.end()
        }
        if (paths.some(deniedPath)) {
          res.statusCode = 403
          return res.end('forbidden')
        }
        next()
      })
    },
  }
}

/**
 * SEC-D-03: dev serves the app's policy too (plus the dev relaxations in server/csp.mjs), so the e2e suite that
 * runs on vite meets the same walls as the app. The Python runner's files keep their own headers
 * (vendorPyodide). With DOJO_CSP_REPORT_FILE set, violations are reported to it (an e2e run asserts none).
 */
export function devCsp(env: Record<string, string | undefined> = process.env): Plugin {
  const reportFile = cspReportFile(env)
  const policy = appCsp({ dev: true, report: !!reportFile })
  return {
    name: 'dojo-dev-csp',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '/').split(/[?#]/, 1)[0]
        if (reportFile && path === CSP_REPORT_PATH && req.method === 'POST') {
          const chunks: Buffer[] = []
          req.on('data', (c: Buffer) => { if (chunks.length < 64) chunks.push(c) })
          req.on('end', () => {
            try { appendFileSync(reportFile, Buffer.concat(chunks).toString('utf8').replace(/\n/g, ' ') + '\n') } catch { /* best effort */ }
            res.statusCode = 204
            res.end()
          })
          return
        }
        if (!inPyPrefix(path)) res.setHeader('Content-Security-Policy', policy)
        next()
      })
    },
  }
}

/**
 * Plan edition. `public/data/plan.json` is the generic sample plan (what tests and the public release use).
 * The private repo keeps the author's original plan in `public/data-private/plan.json`; unless DOJO_PLAN=public, dev and
 * build serve that one as /data/plan.json. `scripts/public-extract.mjs` rewrites DEFAULT_PLAN below to 'public' and drops
 * `public/data-private`. Vitest and the e2e configs use the generic plan.
 */
export const DEFAULT_PLAN = 'public'
export function planEdition(env: Record<string, string | undefined> = process.env): 'private' | 'public' {
  const want = env.DOJO_PLAN || (env.VITEST ? 'public' : DEFAULT_PLAN)
  return want === 'private' ? 'private' : 'public'
}
function privatePlan(): Plugin {
  const file = resolve(APP_ROOT, 'public/data-private/plan.json')
  const on = () => planEdition() === 'private' && existsSync(file)
  let outDir = ''
  return {
    name: 'dojo-private-plan',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (on() && req.method === 'GET' && (req.url ?? '').split('?')[0] === '/data/plan.json') {
          res.setHeader('Content-Type', 'application/json')
          res.end(readFileSync(file))
          return
        }
        next()
      })
    },
    configResolved(config) { outDir = resolve(config.root, config.build.outDir) },
    // publicDir is copied into outDir before closeBundle runs: overwrite its generic plan.json with the private one,
    // in whatever outDir this build uses (install:app builds into its own staging dir), and drop the raw copy.
    closeBundle: {
      order: 'post',
      handler() {
        if (!outDir) return
        rmSync(resolve(outDir, 'data-private'), { recursive: true, force: true })
        if (!on()) return
        const out = resolve(outDir, 'data/plan.json')
        if (existsSync(out)) writeFileSync(out, readFileSync(file))
      },
    },
  }
}

/**
 * Bank packs (third-party problem lists). `@bank-packs` resolves by DOJO_BANK_PACKS:
 *                 dev server and install:app of the private repo.
 *   `public`   -> the empty `src/content/banks/packs.ts` (Plan bank + Mine only). What the public release builds;
 *   `fixtures` -> small original fixture packs (tests; vitest picks it by default, e2e configs set it).
 *   <path>     -> any module of the same shape.
 */
export const DEFAULT_BANK_PACKS = 'public'
export function bankPacksPath(env: Record<string, string | undefined> = process.env): string {
  const want = env.DOJO_BANK_PACKS || (env.VITEST ? 'fixtures' : DEFAULT_BANK_PACKS)
  if (want === 'fixtures') return resolve(APP_ROOT, 'tests/fixtures/banks/packs.ts')
  if (want === 'public') return resolve(APP_ROOT, 'src/content/banks/packs.ts')
  return resolve(want)
}

export default defineConfig({
  resolve: { alias: { '@bank-packs': bankPacksPath() } },
  plugins: [denyServerDir(), devCsp(), vendorPyodide(), privatePlan(), react()],
  server: { host: '127.0.0.1', port, strictPort: true, proxy, fs: { deny: FS_DENY } },
  preview: { host: '127.0.0.1', port, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    // Overnight program: up to 4 chains run at once; keep memory bounded.
    maxWorkers: 2,
    minWorkers: 1,
  },
})

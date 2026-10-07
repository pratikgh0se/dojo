// C-PYTHON §3: Pyodide is vendored, never fetched from a CDN (_common rule 1). The pinned `pyodide` npm
// package's runtime files are copied into the build output under /pyodide/ at build time, and served from
// node_modules under the same path by the dev server. Only the runtime's own files are copied (no source
// maps, no console pages, no typings), plus Pyodide's licence (MPL-2.0) as /pyodide/LICENSE: the npm package
// ships none, so the text lives in scripts/licenses/pyodide/LICENSE. The licences of the components compiled into
// the runtime (CPython, Emscripten, libffi, zlib, bzip2, expat, mpdecimal, HACL*) are in THIRD-PARTY-NOTICES.md.
import { copyFileSync, createReadStream, mkdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FRAME_PATH, frameCsp, isPyAsset, pyAssetHeaders } from '../server/runner/pyframe.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const APP = join(here, '..')
export const PYODIDE_DIR = join(APP, 'node_modules', 'pyodide')
export const PYODIDE_FILES = ['pyodide.js', 'pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
/** Pyodide's licence text (MPL-2.0), copied next to the runtime as LICENSE. */
export const PYODIDE_LICENSE = join(here, 'licenses', 'pyodide', 'LICENSE')
const TYPES = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.zip': 'application/zip', '.json': 'application/json; charset=utf-8', '.html': 'text/html; charset=utf-8', '.py': 'text/plain; charset=utf-8' }
const extOf = p => p.slice(p.lastIndexOf('.'))

/** Copies the runtime into <outDir>/pyodide. Throws when the package is not installed. */
export function copyPyodide(outDir, from = PYODIDE_DIR) {
  const to = join(outDir, 'pyodide')
  mkdirSync(to, { recursive: true })
  for (const f of PYODIDE_FILES) copyFileSync(join(from, f), join(to, f))
  copyFileSync(PYODIDE_LICENSE, join(to, 'LICENSE'))
  return [...PYODIDE_FILES, 'LICENSE'].map(f => join(to, f))
}

/** Vite plugin: vendors Pyodide into the build, and serves it (and the frame's headers) in dev. */
export function vendorPyodide() {
  let outDir = join(APP, 'dist')
  return {
    name: 'dojo-vendor-pyodide',
    // --outDir may be absolute (the e2e and install builds pass one)
    configResolved(cfg) { outDir = resolve(cfg.root, cfg.build.outDir) },
    writeBundle() { copyPyodide(outDir) },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '/').split(/[?#]/, 1)[0]
        if (!isPyAsset(path)) return next()
        if (req.method !== 'GET' && req.method !== 'HEAD') return next()
        const origin = `http://${req.headers.host}`
        for (const [k, v] of Object.entries(pyAssetHeaders(path, origin))) res.setHeader(k, v)
        if (path === FRAME_PATH) res.setHeader('Content-Security-Policy', frameCsp(origin))
        if (!path.startsWith('/pyodide/')) return next() // vite's public dir serves /pyrunner/*
        const name = path.slice('/pyodide/'.length)
        if (!PYODIDE_FILES.includes(name) && name !== 'LICENSE') { res.statusCode = 404; return res.end('not found') }
        const file = name === 'LICENSE' ? PYODIDE_LICENSE : join(PYODIDE_DIR, name)
        res.setHeader('Content-Type', name === 'LICENSE' ? 'text/plain; charset=utf-8' : TYPES[extOf(name)] ?? 'application/octet-stream')
        res.setHeader('Content-Length', statSync(file).size)
        if (req.method === 'HEAD') return res.end()
        createReadStream(file).pipe(res)
      })
    },
  }
}

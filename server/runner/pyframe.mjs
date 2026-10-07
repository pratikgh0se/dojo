// C-PYTHON §3: what the in-browser Python runner needs from the server. Pyodide and the runner frame's
// files are plain static assets, but the frame is sandboxed (an opaque origin), so every request it makes
// is cross-origin and carries `Origin: null`. These assets, and only these, answer that.
//   /pyodide/*   the vendored Pyodide runtime (copied there at build time)
//   /pyrunner/*  the frame page, its scripts and the Python harness (app/public/pyrunner)
// No 'unsafe-eval': learner Python cannot run JS through pyodide.code.run_js / eval inside the worker.
// Never used for /db/* or /tools/*.

export const PY_ASSET_PREFIXES = ['/pyodide/', '/pyrunner/']
export const FRAME_PATH = '/pyrunner/frame.html'

/** Whether a path is under an asset prefix by its raw spelling (safe or not). */
export const inPyPrefix = path => PY_ASSET_PREFIXES.some(p => path.startsWith(p))

/**
 * The decoded path of a Python-runner asset, or null when the request does not name one safely. Encoded
 * slashes or backslashes, NULs, double-encoding, empty or dot segments are refused outright: the CORS
 * headers and the `Origin: null` exemption must never cover a path that decodes out of the two prefixes.
 */
export function pyAssetPath(path) {
  if (!inPyPrefix(path)) return null
  if (/%(?:2f|5c|00|25)/i.test(path) || path.includes('\\')) return null
  let rel
  try { rel = decodeURIComponent(path) } catch { return null }
  if (rel.includes('\0') || rel.includes('\\')) return null
  const parts = rel.split('/').slice(1)
  if (parts.length < 2 || parts.some(p => p === '' || p === '.' || p === '..')) return null
  return rel
}

/** Whether a request path names a Python-runner asset (safely). */
export const isPyAsset = path => pyAssetPath(path) !== null

/**
 * The frame page's Content-Security-Policy: the second wall behind the opaque origin. Its scripts and its
 * worker may load code only from the two asset prefixes (and the worker's own blob), and may connect only
 * to those prefixes, so even a recovered `fetch` or a dynamic import cannot reach /db/*, /tools/* or any
 * other origin. `origin` is the server's own origin as the request named it (Host is pinned already).
 */
export function frameCsp(origin) {
  const assets = PY_ASSET_PREFIXES.map(p => `${origin}${p}`).join(' ')
  return [
    "default-src 'none'",
    `script-src ${assets} blob: 'wasm-unsafe-eval'`,
    `connect-src ${assets}`,
    'worker-src blob:',
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${origin}`,
  ].join('; ')
}

/** Headers for a Python-runner asset response (in addition to type and length). */
export function pyAssetHeaders(path, origin) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    'Cache-Control': path.startsWith('/pyodide/') ? 'public, max-age=3600' : 'no-cache',
  }
  if (path === FRAME_PATH) h['Content-Security-Policy'] = frameCsp(origin)
  return h
}

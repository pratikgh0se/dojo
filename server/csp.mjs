// SEC-D-03: the app document's Content-Security-Policy, the second wall behind every HTML sink (SEC-D-01).
// What the app really loads, all from its own origin:
//   scripts  one module bundle (/assets/*), the picture engines (/engines/*.js, added as <script src>) and
//            three.js (/engines/vendor/three, a dynamic import()). No inline script, no eval, no wasm in the
//            app document: Pyodide runs in the sandboxed /pyrunner/frame.html, which keeps its own policy
//            (pyframe.mjs frameCsp) and is the one document this policy is never sent with.
//   styles   the bundle's CSS and fonts.css, plus the <style> elements and style="" attributes the engines
//            write into their shadow roots ('unsafe-inline' for styles only).
//   images   own files, plus data: and blob: (snapshot and PNG export draw an SVG through a blob: URL).
//   connect  /db, /ai, /tools on the same origin (the desktop build's helper URL is "self").
//   frames   the Python runner's frame (same origin, sandboxed). Nothing else may frame or be framed.
// Node standard library only; imported by dojo-server and by the vite dev server (vite.config.ts).

const BASE = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'"],
  'connect-src': ["'self'"],
  'media-src': ["'self'"],
  'worker-src': ["'self'"],
  'frame-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
  'frame-ancestors': ["'none'"],
}

/**
 * Vite dev only: the React refresh preamble is an inline module script, HMR talks over a WebSocket, and
 * `npm run dev:ai` reaches the AI helper on its own loopback port. Never sent by dojo-server.
 */
const DEV_EXTRA = {
  'script-src': ["'unsafe-inline'"],
  'connect-src': ['ws://127.0.0.1:*', 'ws://localhost:*', 'http://127.0.0.1:*', 'http://localhost:*'],
}

/** The path a test run's CSP reports go to (only when DOJO_CSP_REPORT_FILE is set; see cspReportFile). */
export const CSP_REPORT_PATH = '/__csp-report'

/**
 * The policy string. `dev` adds DEV_EXTRA (vite dev only). `report` appends a report-uri to CSP_REPORT_PATH:
 * e2e runs set DOJO_CSP_REPORT_FILE so every violation in a suite is collected and the run can assert none.
 */
export function appCsp({ dev = false, report = false } = {}) {
  const d = Object.fromEntries(Object.entries(BASE).map(([k, v]) => [k, [...v, ...(dev ? DEV_EXTRA[k] ?? [] : [])]]))
  const parts = Object.entries(d).map(([k, v]) => `${k} ${v.join(' ')}`)
  if (report) parts.push(`report-uri ${CSP_REPORT_PATH}`)
  return parts.join('; ')
}

/** The e2e report sink's file (an absolute path from DOJO_CSP_REPORT_FILE), or null: no reporting. */
export function cspReportFile(env = process.env) {
  const f = env.DOJO_CSP_REPORT_FILE
  return typeof f === 'string' && f.startsWith('/') ? f : null
}

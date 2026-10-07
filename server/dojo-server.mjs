#!/usr/bin/env node
// Dojo server: the built app (static + SPA fallback), the AI helper routes (helper.mjs's handler,
// reused as-is) and the /db/* disk-storage routes. 127.0.0.1 only. Node standard library only.
//   node dojo-server.mjs [--fake] [--dist <dir>] [--parent-pid <pid>] [--real]
//   env DOJO_HOME and DOJO_PORT are required; only --real (Dojo.app) may use ~/Dojo and port 8787, its defaults.
import { timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import { appendFileSync, createReadStream, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JobError } from './claude-runner.mjs'
import { appCsp, CSP_REPORT_PATH, cspReportFile } from './csp.mjs'
import { openDojo } from './db/manager.mjs'
import { createLogger } from './db/log.mjs'
import { DbError } from './db/store.mjs'
import { LinkCheckError, linkCheck } from './linkcheck.mjs'
import { FRAME_PATH, inPyPrefix, isPyAsset, pyAssetHeaders } from './runner/pyframe.mjs'
import { createRunner, LIMITS as RUN_LIMITS, publicPack, sweepStaleRunDirs } from './runner/runner.mjs'
import { buildOriginAllowList, createHelperHandler, HOST, hostOriginProblem, MAX_BODY_BYTES, readBody, readConfig, STATUS } from './helper.mjs'
import { overlayPlan, readProfile, resolveProjectRepo } from './profile.mjs'

export const MAX_OPS_BODY_BYTES = 5 * 1024 * 1024
const BIG_BODY_ROUTES = new Set(['/db/ops'])
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
  // C-PYTHON: the vendored Pyodide runtime (WebAssembly streaming needs the wasm type) and the Python harness.
  '.wasm': 'application/wasm', '.zip': 'application/zip', '.py': 'text/plain; charset=utf-8',
}
const STATUS_EXTRA = { not_found: 404 }
const LINKCHECK_PATH = '/tools/linkcheck'
// C-RUNNER §2: the Go runner (writer only) and the packs' public part (any browser of this origin).
const RUN_PATH = '/tools/run-go'
const PACKS_PREFIX = '/tools/packs/'
/** The run route's body cap: the code (64 KiB, checked after parsing) plus JSON escaping and the other fields. */
export const MAX_RUN_BODY_BYTES = 512 * 1024
const isRunRoute = path => path === RUN_PATH || path.startsWith(PACKS_PREFIX)

function isFile(p) {
  try { return statSync(p).isFile() } catch { return false }
}

/** realpath of p, or of its deepest existing ancestor plus the rest (for paths that do not exist yet). */
function realOr(p) {
  const abs = resolve(p)
  try { return realpathSync(abs) } catch { /* not there yet */ }
  const parent = dirname(abs)
  return parent === abs ? abs : join(realOr(parent), basename(abs))
}

/**
 * I-d: which DOJO_HOME this server may open. The real ~/Dojo is for the installed Dojo.app only, which
 * passes --real; everything else (npm run server, tests, dev) must name its DOJO_HOME, and never ~/Dojo.
 */
export function resolveHome(argv, env) {
  const real = argv.includes('--real')
  const realDojo = join(env.HOME || homedir(), 'Dojo')
  if (!env.DOJO_HOME) {
    if (real) return realDojo
    throw new Error('DOJO_HOME is not set. Pass a data directory explicitly (the real ~/Dojo is only for Dojo.app, which passes --real).')
  }
  const home = resolve(env.DOJO_HOME)
  const target = realOr(home)
  const dojo = realOr(realDojo)
  // Minor 10: macOS volumes (APFS) are case-insensitive by default: ~/DOJO is ~/Dojo.
  const fold = p => (process.platform === 'darwin' ? p.toLowerCase() : p)
  if (!real && (fold(target) === fold(dojo) || fold(target).startsWith(fold(dojo) + sep))) {
    throw new Error(`refusing DOJO_HOME=${home}: that is the real ~/Dojo, which only Dojo.app opens (with --real)`)
  }
  return home
}

export const REAL_APP_PORT = 8787
/** The plan the app fetches (src/data/seed.ts loadPlan). */
const PLAN_PATH = '/data/plan.json'

export function readServerConfig(argv = process.argv.slice(2), env = process.env) {
  const distAt = argv.indexOf('--dist')
  // I1: 8787 is the real app's port, used only by Dojo.app (--real, where it is the default). Every
  // other run names its port, and may not take 8787.
  const real = argv.includes('--real')
  // SEC-D-02: the runner's attack tests alone pass this (they need syscall/unsafe to prove the sandbox); never the app
  if (real && argv.includes('--test-allow-raw-imports')) throw new Error('--test-allow-raw-imports is for the runner tests, never with --real')
  const home = resolveHome(argv, env)
  const portRaw = env.DOJO_PORT
  let port
  if (portRaw === undefined || portRaw === '') {
    if (!real) throw new Error('DOJO_PORT is not set. Pass a port explicitly (8787 is only for Dojo.app, which passes --real).')
    port = REAL_APP_PORT
  } else {
    port = Number(portRaw)
    if (!/^\d+$/.test(portRaw) || port > 65535) throw new Error(`DOJO_PORT must be an integer 0-65535, got "${portRaw}"`)
    if (port === REAL_APP_PORT && !real) throw new Error(`DOJO_PORT ${REAL_APP_PORT} is reserved for Dojo.app (--real)`)
  }
  const dbOrigins = new Set(String(env.DOJO_DB_EXTRA_ORIGINS ?? '').split(',').map(x => x.trim()).filter(Boolean))
  return {
    ...readConfig(argv, env),
    // SEC-D-06: serving an app build (Dojo.app's --real, or --dist), the server answers its own origin (added on
    // listen), DOJO_HELPER_ORIGINS and DOJO_DB_EXTRA_ORIGINS only, never the dev ports. Dev (scripts/dev.mjs, no
    // --dist) keeps them for its vite page.
    originAllowList: new Set([...buildOriginAllowList(env, { devPorts: !(real || distAt >= 0) }), ...dbOrigins]),
    // G6: the project repo from this server's own DOJO_HOME/profile.json (Dojo.app's --real home has no env var)
    projectRoot: resolveProjectRepo(env, readProfile(home)),
    home,
    dist: distAt >= 0 ? resolve(argv[distAt + 1] ?? '') : null,
    dojoPort: port,
    // The e2e harness alone passes this: the link check may then probe 127.0.0.1 (a local page under test).
    linkcheckAllowLoopback: argv.includes('--linkcheck-allow-loopback'),
    runnerAllowRawImports: argv.includes('--test-allow-raw-imports'),
    // /db answers only the server's own origin (added on listen) plus these, e.g. a dev proxy's origin.
    // The Go runner resolves DOJO_GO_BIN / go on PATH from this environment.
    runEnv: env,
    dbOrigins,
    // SEC-D-03: e2e runs only. Every CSP violation report is appended to this file (null: no report-uri at all).
    cspReportFile: cspReportFile(env),
  }
}

const describeError = e => (e instanceof Error ? e.stack ?? e.message : String(e))

/**
 * L1: the request's path, or null when its URL cannot be parsed (`GET //` makes `new URL` throw:
 * an empty host), which the server answers with 400 `{"error":"bad_request"}` rather than a 500.
 */
export function requestPath(req) {
  try {
    return new URL(req.url ?? '/', `http://${HOST}`).pathname
  } catch {
    return null
  }
}

/**
 * H1: wraps a request listener so that nothing it throws (synchronously or as a rejected promise) can
 * escape to the process: the request gets 500 `{"error":"server_error"}` (or its socket is closed, if
 * the headers already went out), and the error is logged.
 */
export function guardHandler(handler, log) {
  return (req, res) => {
    const onError = e => {
      try { log(`ERROR ${req.method} ${req.url}: ${describeError(e)}`) } catch { /* the log must not throw either */ }
      try {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(JSON.stringify({ error: 'server_error' }))
        } else res.destroy()
      } catch { /* the socket is gone */ }
    }
    try {
      Promise.resolve(handler(req, res)).catch(onError)
    } catch (e) {
      onError(e)
    }
  }
}

/**
 * H1: a last line of defence. Request handling is guarded above; anything else that slips out (a
 * timer, a stream callback) is logged and the server keeps serving, rather than exiting on it.
 */
export function installCrashGuards(log, proc = process) {
  proc.on('unhandledRejection', e => { try { log(`ERROR unhandled rejection: ${describeError(e)}`) } catch { /* ignore */ } })
  proc.on('uncaughtException', e => { try { log(`ERROR uncaught exception: ${describeError(e)}`) } catch { /* ignore */ } })
}

/** Builds the server (not yet listening). cfg is readServerConfig()'s result; `clock` is for tests. */
export function createDojoServer(cfg, clock = () => new Date()) {
  // I-d: the database is opened (stale .tmp files cleaned, migrations run) only once this server owns
  // its port; a second server that cannot listen must not touch a running server's files.
  let dojo = null
  const logger = createLogger(cfg.home)
  const helper = createHelperHandler(cfg)
  const distRoot = cfg.dist ? realpathSync(cfg.dist) : null
  const runner = createRunner({ home: cfg.home, env: cfg.runEnv ?? process.env, log: msg => logger.log(msg), allowRawImports: !!cfg.runnerAllowRawImports })
  // SEC-D-03: the app's documents get the full policy (frame-ancestors 'none' is part of it, G4 #7); the Python
  // runner's files keep frame-ancestors alone, and its frame page its own policy (pyframe.mjs).
  const CSP = appCsp({ report: !!cfg.cspReportFile })

  function serveStatic(req, res, path) {
    if (!distRoot) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      return res.end('no --dist configured')
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain', Allow: 'GET, HEAD' })
      return res.end('use GET')
    }
    // Security review L1: a path under the runner prefixes that is not a plain file path is refused here.
    if (inPyPrefix(path) && !isPyAsset(path)) {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' })
      return res.end('not found')
    }
    let rel
    try { rel = decodeURIComponent(path) } catch { rel = path }
    let file = normalize(join(distRoot, rel))
    if (file !== distRoot && !file.startsWith(distRoot + sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' })
      return res.end('forbidden')
    }
    // G6: the shipped plan is a neutral sample; DOJO_HOME/profile.json's `plan` keys (the learner's own schedule
    // and links) are laid over it here, read per request so an edited profile shows on the next launch.
    if (rel === PLAN_PATH && isFile(file) && req.method === 'GET') {
      let body
      try {
        body = Buffer.from(overlayPlan(readFileSync(file, 'utf8'), readProfile(cfg.home)))
      } catch (e) {
        logger.log(`profile.json not applied to ${PLAN_PATH}: ${describeError(e)}`)
        body = readFileSync(file)
      }
      res.writeHead(200, {
        'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache', 'Content-Length': body.length,
        'Content-Security-Policy': CSP, 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
      })
      return res.end(body)
    }
    if (!isFile(file)) {
      // C-PYTHON: a missing runner asset is a 404, never the SPA page (a script would parse HTML as JS).
      if (extname(rel) !== '' || inPyPrefix(path)) {
        res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' })
        return res.end('not found')
      }
      file = join(distRoot, 'index.html') // SPA fallback
    }
    const type = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const hashed = file.startsWith(join(distRoot, 'assets') + sep)
    // C-PYTHON §3: the Python runner's assets are read by a sandboxed frame (an opaque origin): CORS *,
    // and the frame page is framable by this origin alone. Everything else keeps the no-framing headers.
    const headers = {
      'Content-Type': type, 'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache', 'Content-Length': statSync(file).size,
      // G4 #7: no other page may frame Dojo (clickjacking the writer's window). SEC-D-03: the app's own policy.
      'Content-Security-Policy': inPyPrefix(path) ? "frame-ancestors 'none'" : CSP, 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff',
    }
    if (isPyAsset(path) && (file.startsWith(join(distRoot, 'pyodide') + sep) || file.startsWith(join(distRoot, 'pyrunner') + sep))) {
      Object.assign(headers, pyAssetHeaders(path, `http://${req.headers.host}`))
      if (path === FRAME_PATH) delete headers['X-Frame-Options'] // its own CSP says who may frame it
    }
    res.writeHead(200, headers)
    if (req.method === 'HEAD') return res.end()
    createReadStream(file).pipe(res)
  }

  const isWriter = got => {
    if (typeof got !== 'string' || !dojo) return false
    const a = Buffer.from(got)
    const b = Buffer.from(dojo.writerToken)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  async function dbRoute(req, res, path) {
    // The disk routes use their own, narrower allow-list than the AI helper (whose list covers every
    // dev port): only this server's origin and DOJO_DB_EXTRA_ORIGINS may read or write the database.
    const origin = req.headers.origin
    if (typeof origin === 'string' && !cfg.dbOrigins.has(origin)) {
      req.resume()
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', Vary: 'Origin' })
      return res.end(JSON.stringify({ ok: false, error: { code: 'forbidden_origin', message: `origin ${origin} may not use /db` } }))
    }
    const cors = typeof origin === 'string' ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' }
    if (req.method === 'OPTIONS') {
      req.resume()
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Dojo-Writer', 'Access-Control-Max-Age': '600' })
      return res.end()
    }
    const send = (status, body) => {
      if (res.headersSent) return
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors })
      res.end(JSON.stringify(body))
    }
    const fail = (code, message, status) => send(status ?? STATUS[code] ?? STATUS_EXTRA[code] ?? 500, { ok: false, error: { code, message } })
    const get = ['/db/health', '/db/state', '/db/backups']
    const post = ['/db/ops', '/db/backup', '/db/restore', LINKCHECK_PATH]
    if (!get.includes(path) && !post.includes(path)) {
      req.resume()
      return fail('unknown_route', `no route ${path}`)
    }
    if (req.method !== (get.includes(path) ? 'GET' : 'POST')) {
      req.resume()
      return fail('method_not_allowed', get.includes(path) ? 'use GET' : 'use POST')
    }
    try {
      if (req.method === 'GET') {
        // Controller ruling 3 (8): `home` is the data directory, so Settings can show where progress lives.
        // Ruling 23 K5: `userHome` lets it show "~/Dojo/dojo.db" rather than "/Users/<name>/Dojo/dojo.db".
        // G6: projectRepo (DOJO_PROJECT_REPO / profile.json) or null, for the grader's "set your project repo" state.
        if (path === '/db/health') return send(200, { ...dojo.health(), home: cfg.home, userHome: homedir(), projectRepo: cfg.projectRoot ?? null })
        if (path === '/db/state') return send(200, dojo.store.state())
        return send(200, { backups: dojo.listBackups() })
      }
      // Content-Type is checked before the body is read or parsed (forces a CORS preflight).
      if (!/^application\/json(?:\s*;.*)?$/i.test(String(req.headers['content-type'] ?? '').trim())) {
        req.resume()
        return fail('unsupported_media_type', 'Content-Type must be application/json')
      }
      const raw = await readBody(req, BIG_BODY_ROUTES.has(path) ? MAX_OPS_BODY_BYTES : MAX_BODY_BYTES)
      // Addendum 3/4: every write needs the writer token, checked after Host, Origin, type and size.
      if (!isWriter(req.headers['x-dojo-writer'])) return fail('not_writer', 'only the Dojo app may change data (X-Dojo-Writer)', 403)
      let body
      try { body = JSON.parse(raw) } catch { return fail('bad_request', 'body is not valid JSON') }
      if (path === LINKCHECK_PATH) return send(200, { ok: true, results: await linkCheck(body, { allowLoopback: cfg.linkcheckAllowLoopback }) })
      if (path === '/db/ops') return send(200, dojo.store.applyOps(body))
      if (path === '/db/backup') {
        const r = dojo.backupNow()
        logger.log(`backup ${r.file}`)
        return send(200, r)
      }
      const r = dojo.restore(body?.file)
      logger.log(`restore ${r.restored} (pre-restore ${r.preRestore})`)
      return send(200, r)
    } catch (e) {
      if (e instanceof JobError) return fail(e.code, e.message)
      if (e instanceof DbError || e instanceof LinkCheckError) return fail(e.code, e.message, e.status)
      logger.log(`ERROR ${req.method} ${path}: ${e instanceof Error ? e.stack : e}`)
      return fail('server_error', e instanceof Error ? e.message : String(e), 500)
    }
  }

  /**
   * C-RUNNER §2 / Addendum 1 Q3. Errors are exactly `{"error":"<code>"}`.
   * Checks in the /db order: Origin, method, Content-Type, body size, writer token; then the body.
   */
  async function runRoute(req, res, path) {
    const origin = req.headers.origin
    const cors = typeof origin === 'string' ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' }
    const send = (status, body) => {
      if (res.headersSent) return
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors })
      res.end(JSON.stringify(body))
    }
    const fail = (status, error) => send(status, { error })
    if (typeof origin === 'string' && !cfg.dbOrigins.has(origin)) {
      req.resume()
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', Vary: 'Origin' })
      return res.end(JSON.stringify({ error: 'forbidden_origin' }))
    }
    if (req.method === 'OPTIONS') {
      req.resume()
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Dojo-Writer', 'Access-Control-Max-Age': '600' })
      return res.end()
    }
    if (path.startsWith(PACKS_PREFIX)) {
      req.resume()
      if (req.method !== 'GET') return fail(405, 'method_not_allowed')
      let id
      try { id = decodeURIComponent(path.slice(PACKS_PREFIX.length)) } catch { return fail(404, 'unknown_pack') }
      const pack = runner.packs.get(id)
      return pack ? send(200, publicPack(pack)) : fail(404, 'unknown_pack')
    }
    if (req.method !== 'POST') {
      req.resume()
      return fail(405, 'method_not_allowed')
    }
    if (!/^application\/json(?:\s*;.*)?$/i.test(String(req.headers['content-type'] ?? '').trim())) {
      req.resume()
      return fail(415, 'unsupported_media_type')
    }
    let raw
    try {
      raw = await readBody(req, MAX_RUN_BODY_BYTES)
    } catch (e) {
      return fail(413, 'too_large')
    }
    if (!isWriter(req.headers['x-dojo-writer'])) return fail(403, 'not_writer')
    let body
    try { body = JSON.parse(raw) } catch { return fail(400, 'bad_request') }
    const pack = typeof body?.pack === 'string' ? runner.packs.get(body.pack) : undefined
    if (!pack) return fail(400, 'unknown_pack')
    if (typeof body.code !== 'string') return fail(400, 'bad_request')
    if (body.mode !== 'run' && body.mode !== 'submit') return fail(400, 'bad_request')
    if (Buffer.byteLength(body.code, 'utf8') > RUN_LIMITS.codeBytes) return fail(413, 'too_large')
    if (!runner.claim()) return fail(409, 'busy')
    // R5: a client that goes away (closed tab, aborted fetch) stops its run at once
    const gone = new AbortController()
    res.on('close', () => { if (!res.writableFinished) gone.abort() })
    try {
      const out = await runner.run({ pack, code: body.code, mode: body.mode }, { signal: gone.signal })
      logger.log(`run-go ${pack.id} ${body.mode} ${out.status} ${out.ms}ms`)
      return send(200, out)
    } catch (e) {
      logger.log(`ERROR run-go: ${e instanceof Error ? e.stack : e}`)
      return fail(500, 'server_error')
    }
  }

  /** SEC-D-03, e2e runs only (DOJO_CSP_REPORT_FILE): appends one violation report per line. */
  async function cspReport(req, res) {
    let body
    try { body = await readBody(req, MAX_BODY_BYTES) } catch { body = null }
    if (typeof body === 'string' && body) {
      try { appendFileSync(cfg.cspReportFile, body.replace(/\n/g, ' ') + '\n') } catch (e) { logger.log(`csp report not written: ${describeError(e)}`) }
    }
    res.writeHead(204, { 'Cache-Control': 'no-store' })
    return res.end()
  }

  const server = http.createServer(guardHandler(async (req, res) => {
    const path = requestPath(req)
    let problem = hostOriginProblem(req, cfg)
    // C-PYTHON §3: the sandboxed frame's (and its worker's) reads of the runner's own static assets carry
    // `Origin: null`. Only a GET/HEAD of /pyodide/* or /pyrunner/* may pass with it; /db, /tools and
    // every write keep the allow-list, and the Host pin above still applies.
    if (problem?.code === 'forbidden_origin' && req.headers.origin === 'null' && (req.method === 'GET' || req.method === 'HEAD') && path !== null && isPyAsset(path)) problem = null
    if (path === null && !problem) {
      req.resume()
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(JSON.stringify({ error: 'bad_request' }))
    }
    // SEC-D-06: a model job spends the learner's Claude quota and can read the project repo's history: writer only.
    if (!problem && req.method === 'POST' && path.startsWith('/ai/') && !isWriter(req.headers['x-dojo-writer'])) {
      req.resume()
      const origin = req.headers.origin
      const cors = typeof origin === 'string' ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' }
      res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors })
      return res.end(JSON.stringify({ ok: false, error: { code: 'not_writer', message: 'only the Dojo app may run AI jobs (X-Dojo-Writer)' } }))
    }
    if (problem || (req.method === 'OPTIONS' && !path.startsWith('/db/') && path !== LINKCHECK_PATH && !isRunRoute(path)) || path === '/health' || path.startsWith('/ai/')) {
      return helper(req, res) // helper repeats the Host/Origin checks and owns CORS + /ai + /health
    }
    if (path.startsWith('/db/') || path === LINKCHECK_PATH) return dbRoute(req, res, path)
    if (isRunRoute(path)) return runRoute(req, res, path)
    if (cfg.cspReportFile && path === CSP_REPORT_PATH && req.method === 'POST') return cspReport(req, res)
    req.resume()
    return serveStatic(req, res, path)
  }, msg => logger.log(msg)))

  return {
    server, logger,
    get dojo() { return dojo },
    runner,
    listen(port = cfg.dojoPort) {
      return new Promise((ok, err) => {
        server.once('error', err)
        server.listen(port, HOST, () => {
          const actual = server.address().port
          try {
            dojo = openDojo({ home: cfg.home, clock })
          } catch (e) {
            server.close()
            return err(e)
          }
          for (const h of ['http://127.0.0.1', 'http://localhost']) {
            cfg.originAllowList.add(`${h}:${actual}`) // own origin
            cfg.dbOrigins.add(`${h}:${actual}`)
          }
          try { dojo.ensureTodaysBackup() } catch (e) { logger.log(`backup on start failed: ${e}`) }
          dojo.startBackupTimer()
          logger.log(`listening on ${HOST}:${actual} (${cfg.fake ? 'fake' : 'claude'} AI, home ${cfg.home})`)
          ok(actual)
        })
      })
    },
    close() {
      return new Promise(done => {
        server.closeAllConnections?.()
        const finish = () => {
          dojo?.close()
          dojo = null
          done()
        }
        if (!server.listening) return finish()
        server.close(finish)
      })
    },
  }
}

/** --parent-pid <pid>: a positive integer, or null when absent. Throws on anything else. */
export function parentPid(argv) {
  const at = argv.indexOf('--parent-pid')
  if (at < 0) return null
  const raw = argv[at + 1] ?? ''
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`--parent-pid must be a process id, got "${raw}"`)
  return Number(raw)
}

/** True while the process exists (EPERM means it exists but belongs to someone else). */
function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return e?.code === 'EPERM'
  }
}

/**
 * L2: closes the server, then waits (at most `ms`) for a run in flight and its temp-dir removal, so a
 * SIGTERM during a run leaves no dojo-run-* directory behind. R5: the run in flight is killed first
 * (SIGKILL to its group, confirmed), not left to its wall limit, and the shutdown sweep then kills
 * anything of this server's runs still alive and removes its leftover dirs.
 */
export async function gracefulStop(s, ms = 5000) {
  let timer
  const limit = new Promise(r => { timer = setTimeout(r, ms) })
  try {
    s.runner.abort?.()
    await Promise.race([
      Promise.all([s.close(), s.runner.settled()]).then(() => s.runner.sweep?.({ shutdown: true })),
      limit,
    ])
  } finally {
    clearTimeout(timer)
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let parent
  try {
    parent = parentPid(argv)
  } catch (e) {
    console.error(`dojo server: ${e.message}`)
    process.exit(2)
  }
  const cfg = readServerConfig(argv, env)
  const s = createDojoServer(cfg)
  installCrashGuards(msg => { s.logger.log(msg); console.error(`dojo server: ${msg}`) })
  let port
  try {
    port = await s.listen()
  } catch (e) {
    console.error(`dojo server: ${e.message}`)
    s.dojo?.close()
    process.exit(1)
  }
  console.log(`dojo server · ${cfg.fake ? 'fake' : 'claude'} AI · http://${HOST}:${port} · data ${cfg.home}`)
  // L2: a run killed with its server leaves its temp dir; clear what is older than a run can last
  void sweepStaleRunDirs(undefined, 10 * 60_000, msg => s.logger.log(msg)).then(n => { if (n) s.logger.log(`swept ${n} stale dojo-run dir(s)`) })
  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    void gracefulStop(s).catch(() => {}).then(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  if (parent !== null) {
    // I5: the launcher passes its pid; if it dies without running its trap (kill -9, a crash), the
    // server must not keep running in the background. Checked twice a second, so it exits within 2 s.
    const watchdog = setInterval(() => {
      if (alive(parent)) return
      clearInterval(watchdog)
      s.logger.log(`parent ${parent} is gone; stopping`)
      stop()
    }, 500)
  }
  return s
}

const self = fileURLToPath(import.meta.url)
const entry = process.argv[1] ? (() => { try { return realpathSync(process.argv[1]) } catch { return resolve(process.argv[1]) } })() : ''
if (entry && entry === realpathSync(self)) await main()

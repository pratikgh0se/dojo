#!/usr/bin/env node
// Dojo AI helper (C-LADDER §7). 127.0.0.1 only: GET /health, POST /ai/:job, OPTIONS *.
// Real mode spawns the Claude Code CLI with Sonnet (server/claude-runner.mjs); --fake returns the
// app's fake outputs (server/gen/ai-shared.mjs). Node standard library only.
import http from 'node:http'
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JobError, resolveBin, runClaudeJob } from './claude-runner.mjs'
import { fakeOutput } from './gen/ai-shared.mjs'
import { readProfile, resolveProjectRepo } from './profile.mjs'

export const HOST = '127.0.0.1'
export const MODEL = 'sonnet'
export const JOBS = ['hint', 'picture', 'diagram', 'interview', 'grade', 'solution', 'suggest_slide', 'classify']
// v2 part 3: served at /ai/:job like the rest, but NOT listed in GET /health.jobs, which ladder H-50 pins to the 8 above.
export const EXTRA_JOBS = ['brief', 'check', 'review_sprint']
const ALL_JOBS = [...JOBS, ...EXTRA_JOBS]
export const STATUS = {
  bad_request: 400, path_not_allowed: 400, forbidden_host: 403, forbidden_origin: 403, guardrail: 403,
  unknown_job: 404, unknown_route: 404, method_not_allowed: 405, unsupported_media_type: 415,
  too_large: 413, busy: 429, claude_failed: 502, invalid_output: 502, claude_missing: 503, claude_signed_out: 503, timeout: 504,
}
const FAKE_FAIL_CODES = ['claude_missing', 'claude_signed_out', 'timeout', 'claude_failed', 'busy', 'invalid_output', 'guardrail', 'bad_request', 'path_not_allowed', 'unknown_job']
export const MAX_BODY_BYTES = 64 * 1024
export const MAX_FAKE_DELAY_MS = 60_000
const TICKET_OPTIONAL = new Set(['classify', 'suggest_slide', 'review_sprint'])

// The Dojo app's own dev/preview ports (C-LADDER dev port, the parity worktrees' 8790-8796 range,
// and the integration build 8797 plus its helper-mode build 8798).
const DEFAULT_ORIGIN_PORTS = [8787, 8790, 8791, 8792, 8793, 8794, 8795, 8796, 8797, 8798]

/** Origins the helper answers CORS for: the Dojo app's own ports on 127.0.0.1/localhost, plus any
 * extra full origins from DOJO_HELPER_ORIGINS (comma-separated, e.g. "http://localhost:5173").
 * SEC-D-06: a server that serves an app build (dojo-server --real or --dist) passes devPorts: false, so the
 * dev ports are not on its list (its own origin is added when it listens). */
export function buildOriginAllowList(env = process.env, { devPorts = true } = {}) {
  const origins = new Set()
  for (const host of devPorts ? ['http://127.0.0.1', 'http://localhost'] : []) {
    for (const port of DEFAULT_ORIGIN_PORTS) origins.add(`${host}:${port}`)
  }
  for (const extra of String(env.DOJO_HELPER_ORIGINS ?? '').split(',')) {
    const trimmed = extra.trim()
    if (trimmed) origins.add(trimmed)
  }
  return origins
}

export function readConfig(argv = process.argv.slice(2), env = process.env) {
  const int = (v, d, min) => {
    const n = Number(v)
    return v !== undefined && v !== '' && Number.isInteger(n) && n >= min ? n : d
  }
  return {
    fake: argv.includes('--fake'),
    // M3: the smoke script's one real call passes --no-retry so an invalid reply never spends a
    // second claude call (claude-runner.mjs runClaudeJob otherwise retries once).
    noRetry: argv.includes('--no-retry'),
    port: int(env.DOJO_HELPER_PORT, 8788, 0),
    claudeBin: env.DOJO_CLAUDE_BIN || 'claude',
    timeoutMs: int(env.DOJO_HELPER_TIMEOUT_MS, 90_000, 1),
    limit: int(env.DOJO_HELPER_CONCURRENCY, 2, 1),
    // G6: the local project repo the grader may read, DOJO_PROJECT_REPO or DOJO_HOME/profile.json's projectRepo.
    // Unset by default: grading then works from the repo URL and the commit summary alone.
    projectRoot: resolveProjectRepo(env, readProfile(env.DOJO_HOME)),
    // `home` is where the app keeps its data; dojo-server points it at ~/Dojo, so `~` in a path the learner gives is never expanded
    // against it (UAT cu-5 P2-3). `userHome` is the account's.
    home: homedir(),
    userHome: homedir(),
    originAllowList: buildOriginAllowList(env),
    env,
  }
}

function realOrResolved(p) {
  try {
    return realpathSync(p)
  } catch {
    // a path that is not there (yet): its nearest existing parent by real path, then the rest, so a symlinked parent
    // (macOS's /var -> /private/var) cannot make a folder inside the forge repo look like it is outside it
    const abs = resolve(p)
    const up = dirname(abs)
    return up === abs ? abs : join(realOrResolved(up), basename(abs))
  }
}

/** The resolved path when `p` is the project root or below it (after ~, .. and symlinks), else null (and always null with no root). */
export function allowedRepoPath(p, projectRoot, home = homedir()) {
  if (typeof projectRoot !== 'string' || projectRoot === '') return null
  if (typeof p !== 'string' || p.trim() === '') return null
  const expanded = p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p
  if (!isAbsolute(expanded)) return null
  const root = realOrResolved(projectRoot)
  const target = realOrResolved(resolve(expanded))
  return target === root || target.startsWith(root + sep) ? target : null
}

export function validateRequest(job, body, cfg) {
  const bad = m => new JobError('bad_request', m)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('body must be a JSON object')
  const ticket = body.ticket ?? null
  const context = body.context ?? {}
  if (typeof context !== 'object' || Array.isArray(context)) throw bad('context must be an object')
  if (ticket === null) {
    if (!TICKET_OPTIONAL.has(job)) throw bad('ticket is required')
  } else if (typeof ticket !== 'object' || Array.isArray(ticket) || typeof ticket.id !== 'string' || ticket.id === '' || typeof ticket.title !== 'string' || typeof ticket.track !== 'string') {
    throw bad('ticket needs id, title and track')
  }
  let repoPath = null
  switch (job) {
    case 'hint':
      if (context.level !== 1 && context.level !== 2) throw bad('context.level must be 1 or 2')
      break
    case 'diagram':
      if (!Array.isArray(context.deepDives)) throw bad('context.deepDives is required')
      break
    case 'interview':
      if (!Number.isInteger(context.turn) || context.turn < 0) throw bad('context.turn is required')
      break
    case 'solution':
      if (context.gave_up !== true) throw new JobError('guardrail', 'solution needs gave_up: true')
      break
    case 'suggest_slide':
      if (!Array.isArray(context.tickets) || !Number.isInteger(context.count) || context.count < 0) throw bad('context.tickets and context.count are required')
      break
    case 'classify':
      if (typeof context.input !== 'string' || context.input.trim() === '') throw bad('context.input is required')
      break
    case 'brief':
      if (typeof context.kind !== 'string' || typeof context.forge !== 'boolean') throw bad('context.kind and context.forge are required')
      break
    case 'check':
      if (!Array.isArray(context.questions) || context.questions.length === 0) throw bad('context.questions is required')
      break
    case 'review_sprint':
      if (!context.stats || typeof context.stats !== 'object' || !Number.isInteger(context.stats.sprint)) throw bad('context.stats is required')
      break
    case 'grade':
      if (context.repoPath !== undefined) {
        if (!cfg.projectRoot) throw new JobError('path_not_allowed', 'no project repo is set (DOJO_PROJECT_REPO, or projectRepo in DOJO_HOME/profile.json)')
        repoPath = allowedRepoPath(context.repoPath, cfg.projectRoot, cfg.userHome ?? cfg.home)
        if (!repoPath) throw new JobError('path_not_allowed', 'repoPath must be the project repo (DOJO_PROJECT_REPO) or inside it')
      }
      break
  }
  return { request: { ticket, context }, repoPath }
}

/** Reads a request body up to `limit` bytes; rejects with JobError('too_large') past it. */
export function readBody(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    let over = false
    req.on('data', c => {
      size += c.length
      if (size > limit) over = true
      else chunks.push(c)
    })
    req.on('end', () => (over ? reject(new JobError('too_large', `body is over ${limit} bytes`)) : resolveBody(Buffer.concat(chunks).toString('utf8'))))
    req.on('error', reject)
  })
}

/** Host pin (DNS rebinding) then Origin allow-list. Returns {code, message} for the first failure,
 * or null when the request may proceed. Shared by the helper and dojo-server so both keep the same checks. */
export function hostOriginProblem(req, cfg) {
  const localPort = req.socket.localPort
  const hostHeader = req.headers.host
  if (hostHeader !== `127.0.0.1:${localPort}` && hostHeader !== `localhost:${localPort}`) {
    return { code: 'forbidden_host', message: `Host must be 127.0.0.1:${localPort} or localhost:${localPort}` }
  }
  const origin = req.headers.origin
  if (typeof origin === 'string' && !cfg.originAllowList.has(origin)) {
    return { code: 'forbidden_origin', message: `origin ${origin} is not allow-listed` }
  }
  return null
}

/** CORS headers for an allowed Origin (none for no/foreign Origin). */
export function corsHeaders(req, cfg) {
  const origin = req.headers.origin
  return typeof origin === 'string' && cfg.originAllowList.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' }
}

export function createHelper(cfg) {
  return http.createServer(createHelperHandler(cfg))
}

/** The helper's (req, res) request listener, reusable inside another server (dojo-server). */
export function createHelperHandler(cfg) {
  let inFlight = 0
  const mode = cfg.fake ? 'fake' : 'claude'
  const health = () => ({
    ok: true, mode, model: MODEL,
    claude: cfg.fake ? 'skipped' : resolveBin(cfg.claudeBin, cfg.env) ? 'found' : 'missing',
    inFlight, limit: cfg.limit, jobs: JOBS, projectRepo: cfg.projectRoot ?? null,
  })

  async function runFake(job, request, headers) {
    const delay = Number(headers['x-dojo-fake-delay-ms'])
    if (Number.isFinite(delay) && delay > 0) await new Promise(r => setTimeout(r, Math.min(delay, MAX_FAKE_DELAY_MS)))
    const failCode = String(headers['x-dojo-fake-fail'] ?? '').trim()
    if (failCode) throw new JobError(FAKE_FAIL_CODES.includes(failCode) ? failCode : 'claude_failed', `fake ${job} unavailable`)
    return fakeOutput(job, request)
  }

  return async (req, res) => {
    // Registered up front so it catches a disconnect at any point in the request lifecycle. Note:
    // this listens on the *response*, not the request - req's 'close' fires as soon as the request
    // body has been fully received (long before we're done), while res's 'close' only fires early
    // when the underlying connection is torn down before the response completes.
    const controller = new AbortController()
    res.on('close', () => { if (!res.writableEnded) controller.abort() })
    const origin = req.headers.origin
    const originAllowed = typeof origin !== 'string' || cfg.originAllowList.has(origin)
    const cors = typeof origin === 'string' && originAllowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' }
    const send = (status, body) => {
      if (res.headersSent) return
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...cors })
      res.end(JSON.stringify(body))
    }
    const fail = (code, message) => send(STATUS[code] ?? 502, { ok: false, error: { code, message } })

    // (a) Host pinning against DNS rebinding, then (b) the Origin allow-list (covers both the actual
    // request and any preflight). No Origin at all (tests/curl/server-to-server) still works.
    const problem = hostOriginProblem(req, cfg)
    if (problem) {
      req.resume()
      return fail(problem.code, problem.message)
    }
    let path
    try { path = new URL(req.url ?? '/', `http://${HOST}`).pathname } catch {
      req.resume()
      return fail('bad_request', 'the request URL cannot be parsed')
    }

    if (req.method === 'OPTIONS') {
      // SEC-D-06: the app sends its writer token with every job (dojo-server requires it on /ai/*)
      res.writeHead(204, { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Content-Type, X-Dojo-Writer', 'Access-Control-Max-Age': '600' })
      res.end()
      return
    }
    if (path === '/health') {
      if (req.method !== 'GET') return fail('method_not_allowed', 'use GET')
      return send(200, health())
    }
    const m = /^\/ai\/([^/]+)$/.exec(path)
    if (!m) {
      req.resume()
      return fail('unknown_route', `no route ${path}`)
    }
    if (req.method !== 'POST') {
      req.resume()
      return fail('method_not_allowed', 'use POST')
    }
    // (c) POST bodies must declare JSON so a cross-origin browser is forced to preflight; this also
    // rejects the classic "text/plain simple request" CSRF vector that skips preflight entirely.
    const contentType = String(req.headers['content-type'] ?? '').trim()
    if (!/^application\/json(?:\s*;.*)?$/i.test(contentType)) {
      req.resume()
      return fail('unsupported_media_type', 'Content-Type must be application/json')
    }
    let raw
    try {
      raw = await readBody(req)
    } catch (e) {
      return fail(e instanceof JobError ? e.code : 'bad_request', e.message)
    }
    let job
    try {
      job = decodeURIComponent(m[1])
    } catch {
      job = m[1]
    }
    if (!ALL_JOBS.includes(job)) return fail('unknown_job', `unknown job ${job}`)
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      return fail('bad_request', 'body is not valid JSON')
    }
    let checked
    try {
      checked = validateRequest(job, body, cfg)
    } catch (e) {
      return fail(e.code ?? 'bad_request', e.message)
    }
    const bin = cfg.fake ? null : resolveBin(cfg.claudeBin, cfg.env)
    if (!cfg.fake && !bin) return fail('claude_missing', `${cfg.claudeBin} is not installed or not on PATH`)
    if (inFlight >= cfg.limit) return fail('busy', `${inFlight} jobs in flight (limit ${cfg.limit})`)
    inFlight++
    const t0 = Date.now()
    try {
      const output = cfg.fake
        ? await runFake(job, checked.request, req.headers)
        : await runClaudeJob(job, checked.request, { bin, timeoutMs: cfg.timeoutMs, env: cfg.env, repoPath: checked.repoPath, signal: controller.signal, noRetry: cfg.noRetry })
      send(200, { ok: true, job, ticketId: checked.request.ticket?.id ?? null, output, ms: Date.now() - t0, mode })
    } catch (e) {
      fail(e instanceof JobError ? e.code : 'claude_failed', e instanceof Error ? e.message : String(e))
    } finally {
      inFlight--
    }
  }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const cfg = readConfig(argv, env)
  const server = createHelper(cfg)
  server.on('error', e => {
    console.error(`dojo helper: ${e.message}`)
    process.exitCode = 1
  })
  server.listen(cfg.port, HOST, () => {
    const { port } = server.address()
    console.log(`dojo helper · ${cfg.fake ? 'fake' : 'claude'} mode · http://${HOST}:${port}`)
  })
  const stop = () => {
    server.closeAllConnections?.()
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  return server
}

const entry = process.argv[1] ? realOrResolved(process.argv[1]) : ''
if (entry && entry === realOrResolved(fileURLToPath(import.meta.url))) main()

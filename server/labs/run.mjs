// Run checks: `make check` in the learner's lab folder, then read .dojo/results.json. Node standard library only.
// The results file decides the outcome. Exit status and output do not (the output tail is kept for when something went wrong).
import { spawn } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { findOnPath, LAB_MESSAGES, LabError } from './common.mjs'

export const TAIL_CHARS = 4000
const KEEP_CHARS = 16000
const MAX_CHECKS = 200
const STATUSES = ['pass', 'fail', 'skip']
const isStr = v => typeof v === 'string' && v !== ''

/**
 * The checks file as the server stores it, or null when it is not valid: { checks: [{ id, name, status, detail, metrics? }] }
 * with status pass, fail or skip. `summary` is recomputed here, whatever the file says.
 */
export function validateResults(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.checks) || raw.checks.length > MAX_CHECKS) return null
  const checks = []
  const ids = new Set()
  for (const c of raw.checks) {
    if (c === null || typeof c !== 'object' || Array.isArray(c) || !isStr(c.id) || c.id.length > 120 || ids.has(c.id)) return null
    if (!isStr(c.name) || c.name.length > 300 || !STATUSES.includes(c.status)) return null
    if (c.detail !== undefined && typeof c.detail !== 'string') return null
    if (c.metrics !== undefined && (c.metrics === null || typeof c.metrics !== 'object' || Array.isArray(c.metrics))) return null
    ids.add(c.id)
    checks.push({ id: c.id, name: c.name, status: c.status, detail: (c.detail ?? '').slice(0, 2000), ...(c.metrics !== undefined ? { metrics: c.metrics } : {}) })
  }
  const summary = { pass: 0, fail: 0, skip: 0 }
  for (const c of checks) summary[c.status] += 1
  return { checks, summary }
}

/** PATH and HOME are inherited, plus the few variables a toolchain needs; no other secrets are passed on. */
export function labEnv(env) {
  const out = { PYTHONDONTWRITEBYTECODE: '1' }
  for (const k of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL']) if (env[k] !== undefined) out[k] = env[k]
  return out
}

function killGroup(child) {
  try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* gone */ } }
}

/**
 * Runs `make check` in `dir` as its own process group and waits up to `timeoutSec`.
 * Resolves the run: { at, ms, exit (null when it was killed), timedOut, results | null, error?, tail }. Throws LabError('make_missing') when make cannot start
 * (then nothing ran, and the caller stores nothing). `signal` aborts the run (the server is stopping).
 */
export async function runChecks({ dir, timeoutSec, env, signal }) {
  const make = findOnPath('make', env)
  if (!make) throw new LabError('make_missing', LAB_MESSAGES.make_missing)
  const resultsFile = join(dir, '.dojo', 'results.json')
  rmSync(resultsFile, { force: true })
  const at = Date.now()
  const child = spawn(make, ['check'], { cwd: dir, env: labEnv(env), detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let tail = ''
  const keep = c => { tail = (tail + c).slice(-KEEP_CHARS) }
  child.stdout.setEncoding('utf8').on('data', keep)
  child.stderr.setEncoding('utf8').on('data', keep)
  let timedOut = false
  let forced
  const stop = () => {
    killGroup(child)
    forced = forced ?? setTimeout(() => child.emit('close', null, 'SIGKILL'), 2000) // a stuck pipe must not hold the run
  }
  const timer = setTimeout(() => { timedOut = true; stop() }, timeoutSec * 1000)
  const onAbort = () => stop()
  signal?.addEventListener('abort', onAbort, { once: true })
  const exit = await new Promise((done, fail) => {
    child.once('error', fail)
    child.once('close', code => done(code))
  }).catch(e => {
    if (e?.code === 'ENOENT') throw new LabError('make_missing', LAB_MESSAGES.make_missing)
    throw e
  }).finally(() => {
    clearTimeout(timer)
    clearTimeout(forced)
    signal?.removeEventListener('abort', onAbort)
    killGroup(child) // anything the checks left running goes with them
  })
  const run = { at, ms: Date.now() - at, exit: exit ?? null, timedOut, results: null, tail: tail.slice(-TAIL_CHARS) }
  if (timedOut) return run // a results file written before the kill is ignored
  let text
  try { text = readFileSync(resultsFile, 'utf8') } catch { return { ...run, error: 'no_results' } }
  let parsed = null
  try { parsed = validateResults(JSON.parse(text)) } catch { /* not JSON */ }
  return parsed ? { ...run, results: parsed } : { ...run, error: 'bad_results' }
}

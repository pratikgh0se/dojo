// Real-mode runner for the Dojo AI helper (C-LADDER §7.1): spawns the Claude Code CLI with Sonnet,
// prompt on stdin, tools off, a fresh temp cwd per attempt. Node standard library only.
import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { delimiter, join } from 'node:path'
import { checkOutput, jobPrompt, repairOutput, systemPrompt } from './gen/ai-shared.mjs'

export const KILL_GRACE_MS = 2000
export const MAX_STDOUT = 1024 * 1024
export const GIT_TIMEOUT_MS = 10_000
export const GIT_MAX_CHARS = 8000

export class JobError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'JobError'
    this.code = code
  }
}

function isExecutableFile(p) {
  try {
    accessSync(p, constants.X_OK)
    return statSync(p).isFile()
  } catch {
    return false
  }
}

export function resolveBin(bin, env = process.env) {
  if (!bin) return null
  if (bin.includes('/')) return isExecutableFile(bin) ? bin : null
  for (const dir of String(env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const p = join(dir, bin)
    if (isExecutableFile(p)) return p
  }
  return null
}

/**
 * UAT r3 P2: an app launched from the Dock (or by a driver) can lack USER/LOGNAME, and `claude` needs USER to
 * find its Keychain login: without it, it says "not logged in" and exits 1. Fill both from the OS account.
 */
export function claudeEnv(env = process.env) {
  if (env.USER && env.LOGNAME) return env
  let name = env.USER || env.LOGNAME
  if (!name) {
    try { name = userInfo().username } catch { return env }
  }
  return { ...env, USER: env.USER || name, LOGNAME: env.LOGNAME || name }
}

/** What `claude -p` prints (stdout or stderr, plain or in its JSON envelope) when it has no usable login. */
export const SIGNED_OUT = /not logged in|run \/login|invalid api key|"loggedIn"\s*:\s*false|oauth token has expired|authentication_error/i
/** The CLI's own words: its JSON envelope's `result` when it printed one, else the first line. */
function cliText(text) {
  try {
    const j = JSON.parse(text)
    const r = Array.isArray(j) ? [...j].reverse().find(x => x && x.type === 'result') : j
    if (r && typeof r.result === 'string') return r.result
  } catch { /* plain text */ }
  return String(text).trim().split('\n')[0]
}
const signedOutError = detail => new JobError('claude_signed_out', `claude is not signed in: ${cliText(detail).slice(0, 200)}`)

/** `claude auth status` (JSON) says loggedIn:false. Asked only after an unexplained non-zero exit. */
export function reportsSignedOut(bin, env = process.env) {
  return new Promise(resolve => {
    const child = execFile(bin, ['auth', 'status'], { timeout: 5000, maxBuffer: 64 * 1024, env: claudeEnv(env) }, (_e, stdout) => {
      try { resolve(JSON.parse(String(stdout)).loggedIn === false) } catch { resolve(false) }
    })
    child.stdin?.end() // it never needs input
  })
}

export function claudeArgs(job) {
  return [
    '-p', '--model', 'sonnet', '--output-format', 'json',
    '--tools', '', '--strict-mcp-config', '--no-session-persistence',
    // Isolate this call from the operator's own Claude Code config: only the (nonexistent) project
    // settings of the throwaway temp cwd, every hook disabled, and no slash-command expansion.
    '--setting-sources', 'project', '--settings', JSON.stringify({ disableAllHooks: true }), '--disable-slash-commands',
    '--system-prompt', systemPrompt(job),
  ]
}

/** The user prompt: the app's per-job body (task, context, OUTPUT SCHEMA, example) from src/ai/prompts.ts. */
export function buildPrompt(job, req, evidence = '') {
  return jobPrompt(job, { ticket: req.ticket ?? null, context: req.context ?? {} }, evidence)
}

export function parseEnvelope(stdout) {
  let env
  try {
    env = JSON.parse(stdout)
  } catch {
    throw new JobError('claude_failed', `claude printed no JSON envelope: ${String(stdout).slice(0, 200)}`)
  }
  if (Array.isArray(env)) env = [...env].reverse().find(x => x && x.type === 'result')
  if (!env || typeof env.result !== 'string') throw new JobError('claude_failed', 'claude envelope has no result string')
  if (env.is_error === true) throw SIGNED_OUT.test(env.result) ? signedOutError(env.result) : new JobError('claude_failed', env.result.slice(0, 300))
  return env.result
}

/** `req` (optional) lets a shape be repaired knowing what was asked (an interview turn vs its final grade). */
export function parseOutput(job, text, req = {}) {
  const body = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  let value
  try {
    value = JSON.parse(body)
  } catch {
    return { ok: false, error: `${job} output is not JSON` }
  }
  const fixed = repairOutput(job, req, value)
  const problem = checkOutput(job, fixed)
  return problem ? { ok: false, error: problem } : { ok: true, output: fixed }
}

function killGroup(child, signal) {
  try {
    process.kill(-child.pid, signal)
  } catch {
    try { child.kill(signal) } catch { /* already gone */ }
  }
}

export function runClaude(bin, args, prompt, { timeoutMs, env = process.env, signal = null }) {
  return new Promise((resolve, reject) => {
    // The caller may already be gone (e.g. the HTTP request that triggered this job was aborted
    // before we got here) - settle immediately without ever creating a temp dir or spawning claude.
    if (signal?.aborted) {
      reject(new JobError('aborted', 'aborted before claude started'))
      return
    }
    const cwd = mkdtempSync(join(tmpdir(), 'dojo-helper-'))
    let out = ''
    let err = ''
    let settled = false
    let exited = false
    let killTimer
    const settle = (fn, v) => {
      if (settled) return
      settled = true
      fn(v)
    }
    const cleanup = () => rmSync(cwd, { recursive: true, force: true })
    // detached: the child leads its own process group, so a timeout (or an abort) can kill
    // grandchildren too.
    const child = spawn(bin, args, { cwd, env: claudeEnv(env), detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const timer = setTimeout(() => {
      killGroup(child, 'SIGTERM')
      killTimer = setTimeout(() => { if (!exited) killGroup(child, 'SIGKILL') }, KILL_GRACE_MS)
      settle(reject, new JobError('timeout', `claude took longer than ${timeoutMs} ms`))
    }, timeoutMs)
    const onAbort = () => {
      // The caller (the helper's HTTP request) went away - kill the group immediately, but don't
      // settle here: the promise (and so inFlight in the helper) is released once the group is
      // actually dead, in the 'close' handler below.
      killGroup(child, 'SIGTERM')
      killTimer = setTimeout(() => { if (!exited) killGroup(child, 'SIGKILL') }, KILL_GRACE_MS)
    }
    // Already-aborted is handled above, before the process ever spawns; only a later abort needs
    // a listener here.
    signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', c => { if (out.length < MAX_STDOUT) out += c })
    child.stderr.on('data', c => { if (err.length < 4096) err += c })
    child.on('error', e => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      cleanup()
      settle(reject, new JobError(e.code === 'ENOENT' ? 'claude_missing' : 'claude_failed', e.message))
    })
    child.on('close', (code, signalName) => {
      exited = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      signal?.removeEventListener('abort', onAbort)
      cleanup()
      if (code === 0) settle(resolve, out)
      else if (SIGNED_OUT.test(err) || SIGNED_OUT.test(out)) settle(reject, signedOutError(SIGNED_OUT.test(err) ? err : out))
      else settle(reject, new JobError('claude_failed', `claude exited with ${code ?? signalName}${err ? `: ${err.trim().slice(0, 300)}` : ''}`))
    })
    child.stdin.on('error', () => { /* the CLI may exit before it reads stdin */ })
    child.stdin.end(prompt)
  })
}

function git(path, args) {
  return new Promise(resolve => {
    execFile(
      'git', ['-C', path, '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args],
      { timeout: GIT_TIMEOUT_MS, maxBuffer: 512 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } },
      (e, stdout) => resolve(e ? `(git ${args[0]} failed: ${String(e.message).split('\n')[0]})` : String(stdout).slice(0, GIT_MAX_CHARS)),
    )
  })
}

/**
 * UAT cu-5 P2-3: why `path` cannot be graded from, in words the learner can act on, or null when it is a git work tree.
 * Callers pass an already path-guarded path; this only reads (git rev-parse).
 */
export async function gitRepoProblem(path) {
  let isDir = false
  try { isDir = statSync(path).isDirectory() } catch { /* missing */ }
  if (!isDir) return `${path} is not a folder on this Mac`
  const inside = await new Promise(resolve => {
    execFile('git', ['-C', path, '-c', 'core.fsmonitor=false', 'rev-parse', '--is-inside-work-tree'], { timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' } }, (e, out) => resolve(!e && String(out).trim() === 'true'))
  })
  return inside ? null : `${path} is not a git repository`
}

/** Read-only repository evidence for the grade job. Callers pass an already path-guarded path. */
export async function gitEvidence(path, commit) {
  const rev = typeof commit === 'string' && /^[0-9a-f]{4,40}$/i.test(commit) ? commit : 'HEAD'
  // --no-ext-diff/--no-textconv: this evidence feeds an AI prompt, so never let a repo-configured
  // external diff driver or textconv filter (from .gitattributes/.gitconfig, arbitrary commands)
  // run or rewrite what we read - always the raw content.
  const log = await git(path, ['log', '--no-ext-diff', '--no-textconv', '--oneline', '-n', '20'])
  const show = await git(path, ['show', '--no-ext-diff', '--no-textconv', '--stat', '--format=%H %s', rev])
  const diff = await git(path, ['diff', '--no-ext-diff', '--no-textconv', '--stat'])
  return `$ git log --oneline -n 20\n${log}\n\n$ git show --stat ${rev}\n${show}\n\n$ git diff --stat\n${diff}`
}

/** M3: runClaudeJob normally retries once on invalid output. `noRetry` (the smoke script's one real
 * call - integration spec §8) caps it at a single attempt, spending at most one real claude call. */
export async function runClaudeJob(job, req, { bin, timeoutMs, env = process.env, repoPath = null, signal = null, noRetry = false }) {
  const deadline = Date.now() + timeoutMs
  if (repoPath) {
    const problem = await gitRepoProblem(repoPath)
    if (problem) throw new JobError('bad_request', problem)
  }
  const evidence = repoPath ? await gitEvidence(repoPath, req.context?.commit) : ''
  const args = claudeArgs(job)
  let prompt = buildPrompt(job, req, evidence)
  let last = ''
  const maxAttempts = noRetry ? 1 : 2
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const left = deadline - Date.now()
    if (left <= 0) throw new JobError('timeout', `claude took longer than ${timeoutMs} ms`)
    let stdout
    try {
      stdout = await runClaude(bin, args, prompt, { timeoutMs: left, env, signal })
    } catch (e) {
      // an exit with no recognisable text: ask the CLI itself whether it is signed in
      if (e instanceof JobError && e.code === 'claude_failed' && /^claude exited with \d/.test(e.message) && await reportsSignedOut(bin, env)) {
        throw new JobError('claude_signed_out', `claude is not signed in (claude auth status: loggedIn false); ${e.message}`)
      }
      throw e
    }
    const text = parseEnvelope(stdout)
    const parsed = parseOutput(job, text, req)
    if (parsed.ok) return parsed.output
    last = parsed.error
    prompt = `${buildPrompt(job, req, evidence)}\n\nYour previous reply was rejected: ${last}. Reply again with only the corrected JSON object.`
  }
  throw new JobError('invalid_output', last)
}

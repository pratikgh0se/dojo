// Small process helpers for the portfolio module. Node standard library only; no shell is ever used.
import { execFile } from 'node:child_process'

export class PortfolioError extends Error {
  constructor(code, message, extra = {}) {
    super(message)
    this.name = 'PortfolioError'
    this.code = code
    Object.assign(this, extra)
  }
}

/** The last `n` characters of a command's output, trimmed: what goes into an error message. */
export const tail = (s, n = 800) => String(s ?? '').trim().slice(-n)

/**
 * Runs a command and resolves { status, stdout, stderr, error? }: it never rejects. `buffer` keeps stdout as a Buffer (a git blob).
 * A command that cannot start has `status` null and `error` (code ENOENT when it does not exist); a timeout kills it.
 */
export function run(cmd, args, { cwd, env, timeoutMs = 60_000, buffer = false } = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { cwd, env: env ?? process.env, encoding: buffer ? 'buffer' : 'utf8', timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, killSignal: 'SIGKILL' }, (err, stdout, stderr) => {
      const text = s => (Buffer.isBuffer(s) ? s.toString('utf8') : String(s ?? ''))
      if (!err) return resolve({ status: 0, stdout, stderr: text(stderr) })
      resolve({ status: typeof err.code === 'number' ? err.code : null, stdout: stdout ?? (buffer ? Buffer.alloc(0) : ''), stderr: text(stderr), error: err })
    })
  })
}

/** git in `cwd`. GIT_TERMINAL_PROMPT=0: a missing credential fails at once instead of waiting for a prompt nobody can answer. */
export const git = (cwd, args, opts = {}) =>
  run('git', ['-c', 'core.quotepath=false', ...args], { cwd, ...opts, env: { ...(opts.env ?? process.env), GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' } })

// Shared by the lab module (server/labs/*): the error type and its plain lines, a git runner and a PATH lookup.
// Node standard library only.
import { execFile } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export class LabError extends Error {
  /** `detail` is for the server log only (why a definition was refused); the client gets code and message. */
  constructor(code, message, detail) {
    super(message)
    this.name = 'LabError'
    this.code = code
    this.detail = detail
  }
}

/** HTTP status of each lab error code (the body is always { ok: false, error: { code, message } }). */
export const LAB_STATUS = {
  unknown_lab: 404, bad_root: 400, not_set_up: 409, busy: 409, lab_dirty: 409, make_missing: 503, git_missing: 503, git_failed: 500, bad_request: 400,
}

export const LAB_ID = /^[a-z0-9-]+$/

/** The plain lines the app shows (labs.md, "Exact copy"); the server's messages are the same lines, so a route test and the screen agree. */
export const LAB_MESSAGES = {
  bad_root: 'The labs folder must be inside your home folder, and not the home folder itself.',
  unknown_lab: 'This lab is not available in this copy of Dojo.',
  busy: 'The checks are already running. Wait for them to finish.',
  not_set_up: 'The lab folder was not found. Set up the lab again to create it.',
  make_missing: 'make was not found. Install the Xcode command line tools with xcode-select --install, then try again.',
  lab_dirty: 'Commit your work in the lab folder first, then request the review.',
  git_missing: 'git was not found. Install the Xcode command line tools with xcode-select --install, then try again.',
}

export function isDir(p) {
  try { return statSync(p).isDirectory() } catch { return false }
}

/** The first executable called `bin` on env.PATH, or null. */
export function findOnPath(bin, env = process.env) {
  for (const dir of String(env.PATH ?? '').split(delimiter)) {
    if (!dir) continue
    const p = join(dir, bin)
    try { accessSync(p, constants.X_OK); if (statSync(p).isFile()) return p } catch { /* next */ }
  }
  return null
}

/**
 * Runs git. Resolves { code, stdout, stderr } for any exit status; rejects LabError('git_missing') when git cannot be started.
 * The first elements of `args` may be `-c k=v` pairs. Never prompts (GIT_TERMINAL_PROMPT=0) and never pages.
 */
export function git(args, { cwd, env = process.env }) {
  return new Promise((ok, fail) => {
    execFile('git', ['-c', 'core.quotepath=false', ...args], { cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' }, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') return fail(new LabError('git_missing', LAB_MESSAGES.git_missing))
      ok({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })
    })
  })
}

/** `-c` arguments that give a commit an identity only when the learner has none configured. */
export async function identityArgs(cwd, env) {
  const name = await git(['config', '--get', 'user.name'], { cwd, env })
  const email = await git(['config', '--get', 'user.email'], { cwd, env })
  return name.stdout.trim() && email.stdout.trim() ? [] : ['-c', 'user.name=Dojo learner', '-c', 'user.email=learner@localhost']
}

/** Bytes of a string once JSON-encoded (without the quotes): what it costs inside the helper's 64 KiB request body. */
export const jsonBytes = s => Buffer.byteLength(JSON.stringify(s), 'utf8') - 2

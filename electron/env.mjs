// The desktop app's environment (C-DESKTOP), kept apart from main.mjs so it can be unit tested without Electron.
import { execFileSync } from 'node:child_process'
import { accessSync, constants, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/** Where the data lives: DOJO_HOME, else the home baked in at install time (Resources/dojo.json), else ~/Dojo. */
export function resolveHome(env = process.env, resources = process.resourcesPath) {
  if (env.DOJO_HOME) return env.DOJO_HOME
  try { const c = JSON.parse(readFileSync(join(resources, 'dojo.json'), 'utf8')); if (c.home) return c.home } catch { /* none */ }
  return join(homedir(), 'Dojo')
}

const isExe = p => { try { accessSync(p, constants.X_OK); return true } catch { return false } }

/**
 * A GUI app gets no shell PATH (just /usr/bin:/bin:/usr/sbin:/sbin), but the Go runner needs `go`, the AI helper
 * `claude` (itself a Node script) and backups/export the usual tools. Like the old launcher: the login shell's PATH
 * when it answers quickly, then the usual install places (Homebrew, /usr/local, ~/.local/bin, the newest nvm Node).
 */
export function toolPath(env = process.env, home = homedir()) {
  const dirs = []
  try {
    const shellPath = execFileSync(env.SHELL && isExe(env.SHELL) ? env.SHELL : '/bin/zsh', ['-lc', 'printf %s "$PATH"'], { timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    dirs.push(...shellPath.split(delimiter))
  } catch { /* no login shell answer: the fallbacks below */ }
  dirs.push(...String(env.PATH ?? '').split(delimiter))
  dirs.push('/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/local/bin', '/usr/local/go/bin', join(home, '.local', 'bin'), join(home, 'go', 'bin'))
  try {
    const nvm = join(home, '.nvm', 'versions', 'node')
    const newest = readdirSync(nvm).filter(v => /^v\d+\.\d+\.\d+$/.test(v))
      .sort((a, b) => { const x = a.slice(1).split('.').map(Number), y = b.slice(1).split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] }).pop()
    if (newest) dirs.push(join(nvm, newest, 'bin'))
  } catch { /* no nvm */ }
  dirs.push('/usr/bin', '/bin', '/usr/sbin', '/sbin')
  return [...new Set(dirs.filter(Boolean))].join(delimiter)
}


#!/usr/bin/env node
// `npm run dev`: vite on DOJO_PORT (default 8790) with the fake in-browser AI, plus dojo-server --fake
// on DOJO_SERVER_PORT (default 8789)
// with DOJO_HOME=./.dojo-dev, so dev exercises the same disk storage without touching ~/Dojo.
// vite proxies /db and /ai to it. DOJO_DEV_DISK=off starts vite alone (the /db routes then do not
// exist and the app runs on Dexie only, "Not saved to disk").
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 8787 is the real app's port (Dojo.app, ~/Dojo). Dev never uses it, for vite or for its server.
const REAL_APP_PORT = '8787'
const vitePort = process.env.DOJO_PORT || '8790'
const serverPort = process.env.DOJO_SERVER_PORT || '8789'
const disk = process.env.DOJO_DEV_DISK !== 'off'
const home = resolve(root, process.env.DOJO_HOME || '.dojo-dev')

if (vitePort === REAL_APP_PORT || serverPort === REAL_APP_PORT) {
  console.error(`dev: refusing port ${REAL_APP_PORT}: it is reserved for the real Dojo app (use DOJO_PORT 8790+)`)
  process.exit(1)
}
// Compare real paths, so a symlink, "..", or a trailing slash cannot smuggle ~/Dojo in.
const realOr = p => { try { return realpathSync(p) } catch { return resolve(p) } }
const realDojo = realOr(resolve(process.env.HOME || homedir(), 'Dojo'))
const realHome = realOr(home)
// macOS volumes (APFS) are case-insensitive by default: ~/DOJO is ~/Dojo.
const fold = p => (process.platform === 'darwin' ? p.toLowerCase() : p)
if (disk && (fold(realHome) === fold(realDojo) || fold(realHome).startsWith(fold(realDojo) + sep))) {
  console.error('dev: refusing to use ~/Dojo (the real app\'s data) for the dev server')
  process.exit(1)
}

const children = []
function run(cmd, args, env) {
  const c = spawn(process.execPath, [cmd, ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
  children.push(c)
  c.on('exit', code => { stop(); process.exit(code ?? 0) })
  return c
}
function stop() {
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM')
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stop(); process.exit(0) })
process.on('exit', stop)

if (disk) {
  mkdirSync(home, { recursive: true })
  run(join(root, 'server', 'dojo-server.mjs'), ['--fake'], {
    DOJO_HOME: home,
    DOJO_PORT: serverPort,
    DOJO_HELPER_ORIGINS: `http://127.0.0.1:${vitePort},http://localhost:${vitePort}`,
    DOJO_DB_EXTRA_ORIGINS: `http://127.0.0.1:${vitePort},http://localhost:${vitePort}`, // vite proxies /db
  })
}
if (disk) {
  // Addendum 3: only a browser holding the writer token may change data. Open this URL once; the app
  // keeps the token (per origin) and strips it from the address bar.
  const tokenFile = join(home, 'writer.token')
  const t0 = Date.now()
  const timer = setInterval(() => {
    if (existsSync(tokenFile)) {
      clearInterval(timer)
      console.log(`\n  dev writer URL: http://127.0.0.1:${vitePort}/#writer=${readFileSync(tokenFile, 'utf8').trim()}\n`)
    } else if (Date.now() - t0 > 15_000) clearInterval(timer)
  }, 250)
  timer.unref()
}
run(join(root, 'node_modules', 'vite', 'bin', 'vite.js'), [], { DOJO_SERVER_PORT: serverPort, DOJO_DEV_DISK: disk ? 'on' : 'off', VITE_DOJO_DISK: disk ? 'on' : 'off' })

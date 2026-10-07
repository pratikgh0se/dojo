import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import type { BrowserContext } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dojoPort, REAL_APP_PORT } from '../../../dojoPort'
import { assertNotRealDojo } from '../guard'

/** A harness port: `name` from the environment when set (so a run can stay inside a port window), else DOJO_PORT + offset. */
function harnessPort(name: string, offset: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return dojoPort(process.env) + offset
  return dojoPort({ DOJO_PORT: raw })
}
/** The storage project's own dojo-server port: DOJO_STORAGE_PORT, else DOJO_PORT + 100 (8890 by default). Never 8787. */
export const STORAGE_PORT = harnessPort('DOJO_STORAGE_PORT', 100)
export const STORAGE_URL = `http://127.0.0.1:${STORAGE_PORT}`
/** The real-mode project's dojo-server port: DOJO_REAL_PORT, else DOJO_PORT + 102 (8892 by default). Never 8787. */
export const REAL_PORT = harnessPort('DOJO_REAL_PORT', 102)
export const REAL_URL = `http://127.0.0.1:${REAL_PORT}`
const ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export class ServerHarness {
  home = mkdtempSync(join(tmpdir(), 'dojo-e2e-home-'))
  private proc: ChildProcess | null = null

  /**
   * `opts.args` replaces the default server arguments (`--fake --linkcheck-allow-loopback`): a spec that wants the real helper,
   * with a stub CLI standing in for `claude`, leaves `--fake` out; `opts.dist` serves another build than the shared one.
   */
  constructor(readonly port = STORAGE_PORT, readonly extraEnv: Record<string, string> = {}, readonly opts: { args?: string[]; dist?: string } = {}) {
    if (port === REAL_APP_PORT) throw new Error(`the e2e harness never uses port ${REAL_APP_PORT}`)
  }

  get url() { return `http://127.0.0.1:${this.port}` }

  /** Addendum 3: the writer token the server keeps in DOJO_HOME/writer.token. */
  token(): string { return readFileSync(join(this.home, 'writer.token'), 'utf8').trim() }

  /** Makes every page of this context the writer (what the launcher's /#writer=<token> does). */
  async makeWriter(ctx: BrowserContext) {
    await ctx.addInitScript(t => { localStorage.setItem('dojo.writer', t) }, this.token())
  }

  async start() {
    if (this.proc) return
    const dist = this.opts.dist ?? process.env.DOJO_E2E_DIST
    if (!dist) throw new Error('DOJO_E2E_DIST is not set (global setup did not run)')
    this.proc = spawn(process.execPath, ['server/dojo-server.mjs', ...(this.opts.args ?? ['--fake', '--linkcheck-allow-loopback']), '--dist', dist], {
      cwd: ROOT, stdio: 'ignore', env: { ...process.env, ...this.extraEnv, DOJO_HOME: this.home, DOJO_PORT: String(this.port) },
    })
    const p = this.proc
    p.once('exit', () => { if (this.proc === p) this.proc = null })
    for (let i = 0; i < 100; i++) {
      let dbPath: string | null = null
      try {
        const res = await fetch(`${this.url}/db/health`)
        if (res.ok) dbPath = ((await res.json()) as { dbPath: string }).dbPath
      } catch { /* not up yet */ }
      if (dbPath !== null) {
        assertNotRealDojo(dbPath)
        if (!dbPath.startsWith(this.home)) throw new Error(`port ${this.port} is served by another Dojo (${dbPath})`)
        return
      }
      await new Promise(r => setTimeout(r, 100))
    }
    throw new Error('dojo-server did not start')
  }

  async stop() {
    const p = this.proc
    if (!p) return
    this.proc = null
    if (p.exitCode !== null) return
    const done = new Promise<void>(r => p.once('exit', () => r()))
    p.kill('SIGTERM')
    const timer = setTimeout(() => p.kill('SIGKILL'), 5000)
    await done
    clearTimeout(timer)
  }

  async restart() {
    await this.stop()
    await this.start()
  }

  async dispose() {
    await this.stop()
    rmSync(this.home, { recursive: true, force: true })
  }
}

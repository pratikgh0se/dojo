// @vitest-environment node
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// I5: if the launcher dies without running its trap (kill -9, a crash), the server must not live on.
let home: string
let procs: ChildProcess[] = []
afterEach(() => {
  for (const p of procs) if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL')
  procs = []
  if (home) rmSync(home, { recursive: true, force: true })
})
const exited = (p: ChildProcess) => new Promise<number>(r => {
  if (p.exitCode !== null || p.signalCode !== null) return r(Date.now())
  p.once('exit', () => r(Date.now()))
})

describe('dojo-server --parent-pid', () => {
  it('exits within 2 s once its parent process is gone', async () => {
    home = mkdtempSync(join(tmpdir(), 'dojo-watchdog-'))
    const parent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 700)'], { stdio: 'ignore' })
    procs.push(parent)
    const server = spawn(process.execPath, ['server/dojo-server.mjs', '--fake', '--parent-pid', String(parent.pid)], {
      env: { ...process.env, DOJO_HOME: home, DOJO_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    procs.push(server)
    await new Promise<void>((ok, fail) => {
      server.stdout!.on('data', b => { if (String(b).includes('dojo server')) ok() })
      server.once('exit', c => fail(new Error(`server exited early (${c})`)))
    })
    const parentGone = await exited(parent)
    const serverGone = await Promise.race([exited(server), new Promise<number>(r => setTimeout(() => r(-1), 4000))])
    expect(serverGone).toBeGreaterThan(0)
    expect(serverGone - parentGone).toBeLessThan(2000)
  }, 15_000)

  it('refuses a malformed --parent-pid', async () => {
    home = mkdtempSync(join(tmpdir(), 'dojo-watchdog-'))
    const server = spawn(process.execPath, ['server/dojo-server.mjs', '--fake', '--parent-pid', 'abc'], {
      env: { ...process.env, DOJO_HOME: home, DOJO_PORT: '0' }, stdio: 'ignore',
    })
    procs.push(server)
    const code = await new Promise<number | null>(r => server.once('exit', c => r(c)))
    expect(code).not.toBe(0)
  })

  it('the desktop app runs the server in its own process (no parent watchdog needed) and stops it on quit', () => {
    const main = readFileSync('electron/main.mjs', 'utf8')
    expect(main).toContain('createDojoServer(cfg)')
    expect(main).toMatch(/before-quit[\s\S]*gracefulStop/)
  })
})

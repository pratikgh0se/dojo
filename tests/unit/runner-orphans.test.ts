// @vitest-environment node
// R5 (release gate): no learner program outlives its run. A blind test once left a CPU-bound program
// running for 7 hours after its server died: the runner spawns the program in its own session (setsid,
// so the server can kill its whole group), and once the server was gone nothing else stopped it. These
// tests cover each layer of the fix:
//   1. the kill path: timeout, client disconnect and server shutdown SIGKILL the program and confirm it
//      is gone before its temp dir is removed;
//   2. the program limits itself: RLIMIT_CPU, a wall guard compiled into the binary, and exit once its
//      parent is gone (getppid() == 1), so it dies even when the server is SIGKILLed;
//   3. the server's startup and shutdown sweep kills orphaned runs it can prove are Dojo's and removes
//      stale dojo-run-* dirs.
// Every server here gets a private TMPDIR, so its runs and its sweep stay inside that root, and every
// process these tests start is killed in afterAll (matched by that root's exact path).
import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { LIMITS, loadPacks, resolveGo, runGo, sweepStaleRunDirs } from '../../server/runner/runner.mjs'

const SERVER = fileURLToPath(new URL('../../server/dojo-server.mjs', import.meta.url))
const goBin = resolveGo(process.env)
const withGo = goBin ? describe : describe.skip
const p91 = loadPacks().get('p91')!
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

type Proc = { pid: number; ppid: number; pgid: number; command: string }

function processes(): Proc[] {
  const out = execFileSync('/bin/ps', ['-axww', '-o', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const list: Proc[] = []
  for (const l of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s(.*)$/.exec(l)
    if (m) list.push({ pid: Number(m[1]), ppid: Number(m[2]), pgid: Number(m[3]), command: m[4].trim() })
  }
  return list
}

/** Processes whose command line starts with `root/` (only ever ones these tests started). */
const under = (root: string) => processes().filter(p => p.command.startsWith(`${root}/`))
const progsUnder = (root: string) => under(root).filter(p => /\/dojo-run-[^/\s]+\/prog$/.test(p.command))

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function waitFor<T>(f: () => T | undefined | null | false, ms: number, step = 50): Promise<T | undefined> {
  const t0 = Date.now()
  for (;;) {
    const v = f()
    if (v) return v
    if (Date.now() - t0 > ms) return undefined
    await sleep(step)
  }
}

/** How long until pid is gone (Infinity when it outlives `ms`). */
async function timeToDeath(pid: number, ms: number) {
  const t0 = Date.now()
  const gone = await waitFor(() => !alive(pid), ms, 20)
  return gone ? Date.now() - t0 : Infinity
}

const roots: string[] = []
function newRoot(prefix: string) {
  const r = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  roots.push(r)
  return r
}

/** SIGKILLs every process left under a root these tests made (a red run must not leave CPU burners). */
function killLeftovers() {
  for (const r of roots) {
    for (const p of under(r)) {
      try { process.kill(p.pid, 'SIGKILL') } catch { /* gone */ }
    }
  }
}

afterEach(killLeftovers)

afterAll(() => {
  killLeftovers()
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

type Srv = { child: ChildProcess; base: string; home: string; out: () => string; exited: () => boolean }

async function spawnServer(root: string): Promise<Srv> {
  const home = mkdtempSync(join(tmpdir(), 'dojo-orphan-home-'))
  roots.push(home)
  const child = spawn(process.execPath, [SERVER, '--fake'], {
    env: { ...process.env, DOJO_HOME: home, DOJO_PORT: '0', TMPDIR: root }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  let exited = false
  child.on('exit', () => { exited = true })
  child.stdout!.on('data', c => { out += c })
  child.stderr!.on('data', c => { out += c })
  const base = await waitFor(() => /http:\/\/127\.0\.0\.1:(\d+)/.exec(out)?.[0] ?? (exited ? 'exited' : null), 15_000)
  if (!base || base === 'exited') throw new Error(`server did not start: ${out}`)
  return { child, base, home, out: () => out, exited: () => exited }
}

async function stopServer(s: Srv) {
  if (s.exited()) return
  s.child.kill('SIGKILL')
  await waitFor(() => s.exited(), 3000)
}

function startRun(s: Srv, code: string, signal?: AbortSignal) {
  const token = readFileSync(join(s.home, 'writer.token'), 'utf8').trim()
  return fetch(`${s.base}/tools/run-go`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dojo-Writer': token },
    body: JSON.stringify({ pack: 'p91', code, mode: 'run' }), signal,
  }).catch(() => null)
}

const CPU_LOOP = 'package main\nfunc numDecodings(s string) int {\n\tx := 0\n\tfor {\n\t\tx++\n\t}\n}\n'
const SLEEP_FOREVER = 'package main\nimport "time"\nfunc numDecodings(s string) int {\n\ttime.Sleep(time.Hour)\n\treturn 0\n}\n'
const runDirs = (root: string) => readdirSync(root).filter(n => n.startsWith('dojo-run-'))

withGo('R5 layer 1: the kill path', () => {
  it('a normal timeout leaves no process and no temp dir', async () => {
    const code = 'package main\nimport ("fmt"; "os")\nfunc numDecodings(s string) int {\n\twd, _ := os.Getwd()\n\tfmt.Println(os.Getpid(), wd)\n\tfor {\n\t}\n}\n'
    const r = await runGo({ pack: p91, code, mode: 'run' }, { home: newRoot('dojo-orphan-home-') })
    expect(r.status).toBe('timeout')
    const [pid, wd] = r.stdout.trim().split(/\s+/)
    expect(alive(Number(pid))).toBe(false)
    expect(existsSync(wd.replace(/\/home$/, ''))).toBe(false)
  }, 60_000)

  it('a client that disconnects stops its run at once (no waiting for the wall limit)', async () => {
    const root = newRoot('dojo-orphan-root-')
    const s = await spawnServer(root)
    try {
      const ac = new AbortController()
      void startRun(s, CPU_LOOP, ac.signal)
      const prog = await waitFor(() => progsUnder(root)[0], 45_000)
      expect(prog, s.out()).toBeTruthy()
      ac.abort()
      expect(await timeToDeath(prog!.pid, 5000)).toBeLessThan(1500)
      expect(await waitFor(() => runDirs(root).length === 0, 3000), runDirs(root).join()).toBe(true)
    } finally {
      await stopServer(s)
    }
  }, 90_000)

  it('SIGTERM to the server kills a run in flight at once and leaves no temp dir', async () => {
    const root = newRoot('dojo-orphan-root-')
    const s = await spawnServer(root)
    try {
      void startRun(s, CPU_LOOP)
      const prog = await waitFor(() => progsUnder(root)[0], 45_000)
      expect(prog, s.out()).toBeTruthy()
      s.child.kill('SIGTERM')
      expect(await timeToDeath(prog!.pid, 5000)).toBeLessThan(1500)
      expect(await waitFor(() => s.exited(), 6000)).toBe(true)
      expect(runDirs(root)).toEqual([])
    } finally {
      await stopServer(s)
    }
  }, 90_000)
})

withGo('R5 layer 2: the program limits itself, even orphaned', () => {
  it('the server SIGKILLed mid-run: an infinite CPU loop dies within 6 s', async () => {
    const root = newRoot('dojo-orphan-root-')
    const s = await spawnServer(root)
    void startRun(s, CPU_LOOP)
    const prog = await waitFor(() => progsUnder(root)[0], 45_000)
    expect(prog, s.out()).toBeTruthy()
    s.child.kill('SIGKILL')
    expect(await timeToDeath(prog!.pid, 8000)).toBeLessThan(6000)
  }, 90_000)

  it('the server SIGKILLed mid-run: a program asleep forever dies within the wall limit plus grace', async () => {
    const root = newRoot('dojo-orphan-root-')
    const s = await spawnServer(root)
    void startRun(s, SLEEP_FOREVER)
    const prog = await waitFor(() => progsUnder(root)[0], 45_000)
    expect(prog, s.out()).toBeTruthy()
    s.child.kill('SIGKILL')
    expect(await timeToDeath(prog!.pid, LIMITS.wallMs + LIMITS.wallGraceMs + 3000)).toBeLessThan(LIMITS.wallMs + LIMITS.wallGraceMs)
  }, 90_000)

  it('RLIMIT_CPU stops a CPU-bound program on its own (the parent\'s wall limit set far away)', async () => {
    const t0 = Date.now()
    const r = await runGo({ pack: p91, code: CPU_LOOP, mode: 'run' }, { home: newRoot('dojo-orphan-home-'), limits: { ...LIMITS, wallMs: 20_000, cpuSoftSec: 1, cpuHardSec: 2 } })
    expect(r.status).toBe('timeout')
    expect(Date.now() - t0).toBeLessThan(15_000) // far under the parent's 20 s, with room for a cold build
  }, 60_000)

  it('the compiled-in wall guard stops a sleeping program on its own', async () => {
    const t0 = Date.now()
    const r = await runGo({ pack: p91, code: SLEEP_FOREVER, mode: 'run' }, { home: newRoot('dojo-orphan-home-'), limits: { ...LIMITS, wallMs: 20_000, wallGraceMs: -18_500 } })
    expect(r.status).toBe('timeout')
    expect(Date.now() - t0).toBeLessThan(15_000) // far under the parent's 20 s, with room for a cold build
  }, 60_000)

  it('inside the sandbox the program sees RLIMIT_CPU 4/5 s (not raisable) and can read getppid', async () => {
    const code = `package main
import ("fmt"; "os"; "syscall")
func numDecodings(s string) int {
	var l syscall.Rlimit
	syscall.Getrlimit(syscall.RLIMIT_CPU, &l)
	fmt.Println("cpu", l.Cur, l.Max)
	l.Max = 100
	fmt.Println("raise", syscall.Setrlimit(syscall.RLIMIT_CPU, &l) != nil)
	fmt.Println("ppid", os.Getppid() > 1)
	return 0
}
`
    const r = await runGo({ pack: p91, code, mode: 'run' }, { home: newRoot('dojo-orphan-home-'), allowRawImports: true }) // SEC-D-02: test only
    expect(r.status).toBe('ok')
    expect(r.stdout).toContain(`cpu ${LIMITS.cpuSoftSec} ${LIMITS.cpuHardSec}`)
    expect(LIMITS.cpuSoftSec).toBe(4)
    expect(LIMITS.cpuHardSec).toBe(5)
    expect(r.stdout).toContain('raise true')
    expect(r.stdout).toContain('ppid true')
  }, 60_000)
})

withGo('R5 layer 3: the startup and shutdown sweep', () => {
  let sleeper = ''
  beforeAll(() => {
    const dir = newRoot('dojo-orphan-build-')
    writeFileSync(join(dir, 'go.mod'), 'module sleeper\n\ngo 1.22\n')
    writeFileSync(join(dir, 'main.go'), 'package main\n\nimport "time"\n\nfunc main() { time.Sleep(time.Hour) }\n')
    sleeper = join(dir, 'sleeper')
    execFileSync(goBin!, ['build', '-o', sleeper, '.'], { cwd: dir, env: { ...process.env, GOTOOLCHAIN: 'local', GOFLAGS: '', CGO_ENABLED: '0' } })
  }, 60_000)

  /** A pid that no process has (a short-lived child's, after it exits). */
  const deadPid = () => {
    const pid = Number(execFileSync('/bin/sh', ['-c', 'echo $$'], { encoding: 'utf8' }).trim())
    expect(alive(pid)).toBe(false)
    return pid
  }

  /** Copies the sleeper to dir/prog and starts it orphaned (its parent exits, so its ppid is 1). */
  const plantOrphan = (dir: string, args: string[] = []) => {
    mkdirSync(join(dir, 'home'), { recursive: true })
    const prog = join(dir, 'prog')
    if (!existsSync(prog)) { copyFileSync(sleeper, prog); chmodSync(prog, 0o755) }
    const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
    const pid = Number(execFileSync('/bin/sh', ['-c', `${[prog, ...args].map(q).join(' ')} </dev/null >/dev/null 2>&1 & echo $!`], { encoding: 'utf8' }).trim())
    return pid
  }

  it('kills only orphaned Dojo programs it can prove are runs, and removes only stale run dirs', async () => {
    const root = newRoot('dojo-orphan-root-')
    const dead = deadPid()
    const stale = join(root, `dojo-run-${dead}-aB3dE9`)
    const orphan = plantOrphan(stale)
    // same binary path but an extra argument: not a run's command line, so never killed
    const lookalikeDir = join(root, `dojo-run-${dead}-zZ9yY8`)
    const lookalike = plantOrphan(lookalikeDir, ['x'])
    // a live run of a live server (this process): its program is not an orphan, its dir is fresh
    const liveDir = join(root, `dojo-run-${process.pid}-qQ1wW2`)
    mkdirSync(join(liveDir, 'home'), { recursive: true })
    copyFileSync(sleeper, join(liveDir, 'prog'))
    chmodSync(join(liveDir, 'prog'), 0o755)
    const live = spawn(join(liveDir, 'prog'), [], { stdio: 'ignore' })
    // a dead server's dir with nothing running in it
    const empty = join(root, `dojo-run-${dead}-eE5rR6`)
    mkdirSync(empty)
    try {
      await waitFor(() => processes().find(p => p.pid === orphan)?.ppid === 1, 3000)
      expect(processes().find(p => p.pid === orphan)?.ppid).toBe(1)
      await sweepStaleRunDirs(root, 10 * 60_000)
      expect(alive(orphan)).toBe(false)
      expect(existsSync(stale)).toBe(false)
      expect(existsSync(empty)).toBe(false)
      expect(alive(lookalike)).toBe(true)
      expect(alive(live.pid!)).toBe(true)
      expect(existsSync(liveDir)).toBe(true)
    } finally {
      live.kill('SIGKILL')
      try { process.kill(lookalike, 'SIGKILL') } catch { /* gone */ }
    }
  }, 30_000)

  it('a server restart sweeps a planted stale run: the orphan dies and its dir is removed', async () => {
    const root = newRoot('dojo-orphan-root-')
    const stale = join(root, `dojo-run-${deadPid()}-pL4nT5`)
    const orphan = plantOrphan(stale)
    await waitFor(() => processes().find(p => p.pid === orphan)?.ppid === 1, 3000)
    expect(alive(orphan)).toBe(true)
    const s = await spawnServer(root)
    try {
      expect(await timeToDeath(orphan, 5000)).toBeLessThan(5000)
      expect(await waitFor(() => !existsSync(stale), 3000)).toBe(true)
    } finally {
      await stopServer(s)
    }
  }, 60_000)
})

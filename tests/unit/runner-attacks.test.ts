// @vitest-environment node
// Attack tests for the Go runner and dojo-server (security review of Part 4a). The threat model is
// untrusted learner code plus any web page the writer visits. Each attack runs against a real,
// spawned dojo-server (so an attack that kills or hangs the process is caught), and the server
// must answer /db/health 200 afterwards.
import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveGo } from '../../server/runner/runner.mjs'

const SERVER = fileURLToPath(new URL('../../server/dojo-server.mjs', import.meta.url))

type Srv = { child: ChildProcess; base: string; home: string; dist: string; log: () => string; exited: () => boolean }

async function spawnServer(env: Record<string, string> = {}): Promise<Srv> {
  const home = mkdtempSync(join(tmpdir(), 'dojo-attack-home-'))
  const dist = mkdtempSync(join(tmpdir(), 'dojo-attack-dist-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'index.html'), '<html>app</html>')
  // SEC-D-02: the attacks need syscall and unsafe, which learner code may not import; the test-only flag lets them
  // through so these tests prove the sandbox itself holds (two walls, each tested on its own)
  const child = spawn(process.execPath, [SERVER, '--fake', '--dist', dist, '--test-allow-raw-imports'], {
    env: { ...process.env, DOJO_HOME: home, DOJO_PORT: '0', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  let exited = false
  child.on('exit', () => { exited = true })
  child.stdout!.on('data', c => { out += c })
  child.stderr!.on('data', c => { out += c })
  const base = await new Promise<string>((ok, err) => {
    const t = setTimeout(() => err(new Error(`server did not start: ${out}`)), 15_000)
    const check = () => {
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out)
      if (m) { clearTimeout(t); ok(`http://127.0.0.1:${m[1]}`) } else if (exited) { clearTimeout(t); err(new Error(`server exited: ${out}`)) } else setTimeout(check, 50)
    }
    check()
  })
  return { child, base, home, dist, log: () => out, exited: () => exited }
}

async function stopServer(s: Srv) {
  if (!s.exited()) {
    s.child.kill('SIGTERM')
    await new Promise(r => { s.child.once('exit', r); setTimeout(r, 3000) })
    if (!s.exited()) s.child.kill('SIGKILL')
  }
  rmSync(s.home, { recursive: true, force: true })
  rmSync(s.dist, { recursive: true, force: true })
}

const health = async (s: Srv) => {
  try { return (await fetch(s.base + '/db/health')).status } catch { return 0 }
}

describe('server hardening (no Go needed)', () => {
  let s: Srv
  beforeAll(async () => { s = await spawnServer() }, 30_000)
  afterAll(async () => { await stopServer(s) })

  it('H1: GET /tools/packs/% (a bad escape) is 404 unknown_pack and the server stays up', async () => {
    for (const p of ['/tools/packs/%', '/tools/packs/%E0%A4%A', '/tools/packs/%zz']) {
      const r = await fetch(s.base + p)
      expect(r.status, p).toBe(404)
      expect(await r.json(), p).toEqual({ error: 'unknown_pack' })
    }
    await new Promise(r => setTimeout(r, 200))
    expect(s.exited()).toBe(false)
    expect(await health(s)).toBe(200)
  })

  it('H1: bad escapes on every other route are answered, never crash the server', async () => {
    for (const p of ['/%', '/assets/%', '/db/%', '/ai/%', '/tools/%', '/tools/run-go%', '/%2e%2e/%']) {
      const r = await fetch(s.base + p)
      expect(r.status, p).toBeLessThan(600)
      await r.text()
    }
    const post = await fetch(s.base + '/ai/%', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    await post.text()
    expect(s.exited()).toBe(false)
    expect(await health(s)).toBe(200)
  })
  it('L1: an unparseable request URL (GET //, //:x, ///) is 400 bad_request, not 500', async () => {
    for (const p of ['//', '//:x', '///', '//%zz', '//a:b@']) {
      for (const method of ['GET', 'POST']) {
        const r = await fetch(s.base + p, method === 'POST' ? { method, headers: { 'Content-Type': 'application/json' }, body: '{}' } : {})
        expect(r.status, `${method} ${p}`).toBe(400)
        expect(await r.json(), `${method} ${p}`).toEqual({ error: 'bad_request' })
      }
    }
    expect(s.log()).not.toMatch(/ERROR GET \/\//)
    expect(await health(s)).toBe(200)
  })
})

const withGo = resolveGo(process.env) ? describe : describe.skip

withGo('learner-code attacks (Go toolchain present)', () => {
  let s: Srv
  beforeAll(async () => { s = await spawnServer() }, 30_000)
  afterAll(async () => { await stopServer(s) })
  const token = () => readFileSync(join(s.home, 'writer.token'), 'utf8').trim()
  const run = async (code: string, mode: 'run' | 'submit' = 'run') => {
    const r = await fetch(s.base + '/tools/run-go', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dojo-Writer': token() },
      body: JSON.stringify({ pack: 'p91', code, mode }),
    })
    expect(r.status).toBe(200)
    return r.json() as Promise<{ status: string; cases: { pass: boolean; got: unknown }[]; errors: { line: number; message: string }[]; stdout: string; steps: unknown[]; truncated: boolean }>
  }
  const T = 60_000
  const healthy = async () => {
    expect(s.exited(), s.log()).toBe(false)
    expect(await health(s)).toBe(200)
  }

  it('baseline: the server answers runs', async () => {
    expect((await run('package main\nfunc numDecodings(s string) int { return 0 }\n')).status).toBe('ok')
    await healthy()
  }, T)

  it('H2: learner code cannot signal the server (its parent) or any other process', async () => {
    const victim = spawn('/bin/sleep', ['60'], { stdio: 'ignore' })
    try {
      const r = await run(`package main
import ("fmt"; "os"; "syscall")
func numDecodings(s string) int {
	fmt.Println("ppid:", syscall.Kill(os.Getppid(), syscall.SIGKILL))
	fmt.Println("server:", syscall.Kill(${s.child.pid}, syscall.SIGKILL))
	fmt.Println("victim:", syscall.Kill(${victim.pid}, syscall.SIGKILL))
	fmt.Println("group:", syscall.Kill(-${victim.pid}, syscall.SIGKILL))
	fmt.Println("self:", syscall.Kill(os.Getpid(), 0))
	return 0
}
`)
      expect(r.status).toBe('ok')
      expect(r.stdout).toMatch(/ppid: operation not permitted/)
      expect(r.stdout).toMatch(/server: operation not permitted/)
      expect(r.stdout).toMatch(/victim: operation not permitted/)
      expect(r.stdout).toMatch(/self: <nil>/)
      await new Promise(r => setTimeout(r, 200))
      expect(victim.exitCode).toBeNull()
      expect(victim.signalCode).toBeNull()
      await healthy()
    } finally {
      victim.kill('SIGKILL')
    }
  }, T)

  it('M1: results and events written straight to fd 4 / fd 3 in init, then os.Exit(0), are rejected (runtime_error)', async () => {
    const r = await run(`package main
import ("os"; "fmt")
func init() {
	r := os.NewFile(4, "r")
	for i := 1; i <= 5; i++ { fmt.Fprintf(r, "{\\"id\\":%d,\\"got\\":%d}\\n", i, []int{2, 3, 0, 2, 4}[i-1]) }
	r.Write([]byte("{\\"done\\":true}\\n"))
	e := os.NewFile(3, "e")
	e.Write([]byte("T 0 1 3 \\"forged\\"\\nS 0 0 1 9 -1 0\\n"))
	os.Exit(0)
}
func numDecodings(s string) int { return 0 }
`, 'submit')
    expect(r.status).toBe('runtime_error')
    expect(r.cases.filter(c => c.pass)).toHaveLength(0)
    expect(r.steps).toEqual([])
    await healthy()
  }, T)

  it('M1: forging with any guessable framing from inside a case fails too', async () => {
    const r = await run(`package main
import ("os"; "fmt"; "io")
func numDecodings(s string) int {
	k, err := io.ReadAll(os.NewFile(5, "k"))
	fmt.Println("key:", len(k), err != nil)
	r := os.NewFile(4, "r")
	fmt.Fprintf(r, "%s {\\"id\\":2,\\"got\\":3}\\n", k)
	fmt.Fprintf(r, "{\\"id\\":2,\\"got\\":3}\\n")
	return 0
}
`)
    expect(r.status).toBe('ok')
    expect(r.cases.map(c => c.got)).toEqual([0, 0])
    expect(r.stdout).toMatch(/key: 0 /)
    await healthy()
  }, T)

  it('M1: calling the harness entry point from learner code is refused', async () => {
    const r = await run(`package main
import "dojo/tk"
func init() { tk.DojoHarness([]func() string{ func() string { return "2" }, func() string { return "3" } }) }
func numDecodings(s string) int { return 0 }
`)
    expect(r.cases.filter(c => c.pass)).toHaveLength(0)
    expect(r.status).toBe('runtime_error')
    expect(r.errors[0].message).toContain('DojoHarness is for the Dojo runner only')
    await healthy()
  }, T)

  it('M1: //go:linkname is refused at compile time', async () => {
    const r = await run(`package main
import _ "unsafe"
//go:linkname key dojo/tk/internal/wire.key
var key string
func numDecodings(s string) int { return 0 }
`)
    expect(r.status).toBe('compile_error')
    expect(r.errors[0].message).toMatch(/go:linkname/)
    expect(r.errors[0].line).toBe(3)
    await healthy()
  }, T)

  it('security M2: read-only, mode-000 and immutable files in the temp dir cannot break cleanup', async () => {
    const r = await run(`package main
import ("fmt"; "os"; "syscall")
func numDecodings(s string) int {
	wd, _ := os.Getwd()
	fmt.Println("wd:" + wd)
	os.MkdirAll(wd+"/a/b/c", 0o755)
	os.WriteFile(wd+"/a/b/c/f", []byte("x"), 0o644)
	os.WriteFile(wd+"/a/ro", []byte("x"), 0o400)
	fmt.Println("chflags:", syscall.Chflags(wd+"/a/b/c/f", 0x2))
	fmt.Println("chmod:", os.Chmod(wd+"/a/b", 0o500))
	fmt.Println("mkdir0:", os.Mkdir(wd+"/a/locked", 0))
	os.Mkdir(wd+"/a/b/c/ro", 0o500)
	return 0
}
`)
    expect(r.status).toBe('ok')
    expect(r.stdout).toMatch(/chflags: operation not permitted/)
    expect(r.stdout).toMatch(/chmod: .*operation not permitted/)
    const wd = /wd:(\S+)/.exec(r.stdout)![1]
    expect(existsSync(wd.replace(/\/home$/, ''))).toBe(false)
    await healthy()
  }, T)

  it('fd exhaustion: the program gets RLIMIT_NOFILE 256 and cannot raise it', async () => {
    const r = await run(`package main
import ("fmt"; "os"; "syscall")
func numDecodings(s string) int {
	var lim syscall.Rlimit
	syscall.Getrlimit(syscall.RLIMIT_NOFILE, &lim)
	fmt.Println("limit:", lim.Cur, lim.Max)
	lim.Cur, lim.Max = 100000, 100000
	fmt.Println("raise:", syscall.Setrlimit(syscall.RLIMIT_NOFILE, &lim) != nil)
	n := 0
	var keep []*os.File
	for i := 0; i < 100000; i++ {
		f, err := os.Open("/dev/null")
		if err != nil { break }
		keep = append(keep, f)
		n++
	}
	fmt.Println("opened:", n)
	return 0
}
`)
    expect(r.status).toBe('ok')
    expect(r.stdout).toContain('limit: 256 256')
    expect(r.stdout).toContain('raise: true')
    expect(Number(/opened: (\d+)/.exec(r.stdout)![1])).toBeLessThan(256)
    await healthy()
  }, T)

  it('thread flood: OS threads are capped (runtime_error, quickly)', async () => {
    const t0 = Date.now()
    const r = await run(`package main
import ("runtime"; "time")
func numDecodings(s string) int {
	for i := 0; i < 5000; i++ { go func() { runtime.LockOSThread(); time.Sleep(10 * time.Second) }() }
	time.Sleep(2 * time.Second)
	return 0
}
`)
    expect(r.status).toBe('runtime_error')
    expect(r.errors[0].message).toMatch(/thread/i)
    expect(Date.now() - t0).toBeLessThan(10_000)
    await healthy()
  }, T)

  it('goroutine flood: goroutines are capped (runtime_error)', async () => {
    const r = await run(`package main
func numDecodings(s string) int {
	for { go func() { select {} }() }
}
`)
    expect(r.status).toBe('runtime_error')
    expect(r.errors[0].message).toMatch(/goroutines/i)
    await healthy()
  }, T)

  // Security round 2 M-A: the profile allows exec of the program's own path, so learner code could
  // re-exec itself with its own pipe on fd 5, and the new instance used to read its limits from it.
  const REEXEC = (stage2: string) => `package main
import ("fmt"; "os"; "runtime"; "syscall"; "time")
func flood(tag string) {
	for i := 0; i < 60000; i++ { go func() { select {} }() }
	time.Sleep(50 * time.Millisecond)
	fmt.Println(tag, "flooded:", runtime.NumGoroutine())
}
func numDecodings(s string) int {
	if os.Getenv("STAGE2") != "" { flood("stage2"); return 0 }
	r, w, _ := os.Pipe()
	w.WriteString(${JSON.stringify(stage2)})
	w.Close()
	fmt.Println("dup2:", syscall.Dup2(int(r.Fd()), 5))
	fmt.Println("exec:", syscall.Exec(os.Args[0], os.Args, append(os.Environ(), "STAGE2=1")))
	flood("stage1")
	return 0
}
`

  it('M-A: a self re-exec with learner-chosen limits on fd 5 still hits the goroutine cap', async () => {
    for (const fd5 of ['aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 1099511627776 1000000 1099511627776\n', 'k 1099511627776 1000000\n']) {
      const r = await run(REEXEC(fd5))
      expect(r.status, r.stdout).toBe('runtime_error')
      expect(r.errors[0].message, r.stdout).toMatch(/more than 10000 goroutines/)
      expect(r.stdout).not.toMatch(/flooded/)
      expect(r.stdout).not.toMatch(/exec: <nil>/)
    }
    await healthy()
  }, T)

  it('M-A: the program cannot re-create, link or replace its binary to exec it again', async () => {
    const r = await run(`package main
import ("fmt"; "os"; "path/filepath"; "syscall")
func numDecodings(s string) int {
	p := os.Args[0]
	_, err := os.Stat(p)
	fmt.Println("stat:", os.IsNotExist(err))
	fmt.Println("write:", os.WriteFile(p, []byte("#!/bin/sh\\n"), 0o755) != nil)
	alt := filepath.Join(filepath.Dir(p), "x")
	os.WriteFile(alt, []byte("x"), 0o755)
	fmt.Println("rename:", os.Rename(alt, p) != nil)
	fmt.Println("link:", os.Link(alt, p) != nil)
	fmt.Println("symlink:", os.Symlink(alt, p) != nil)
	fmt.Println("execalt:", syscall.Exec(alt, []string{alt}, nil) != nil)
	fmt.Println("exec:", syscall.Exec(p, os.Args, nil) != nil)
	return 0
}
`)
    expect(r.status, JSON.stringify(r.errors)).toBe('ok')
    for (const k of ['stat', 'write', 'rename', 'link', 'symlink', 'execalt', 'exec']) expect(r.stdout).toContain(`${k}: true`)
    await healthy()
  }, T)

  it('infinite recursion: always a runtime_error that names the stack overflow, at the learner\'s line', async () => {
    for (let k = 0; k < 3; k++) {
      const r = await run('package main\nfunc f(n int) int {\n\treturn f(n+1) + 1\n}\nfunc numDecodings(s string) int { return f(0) }\n')
      expect(r.status).toBe('runtime_error')
      expect(r.errors[0].message).toMatch(/stack overflow|infinite recursion/i)
      expect([2, 3]).toContain(r.errors[0].line)
    }
    await healthy()
  }, T)

  // R5: os/signal is refused at compile time. With it, hostile code could ignore SIGURG (no async
  // preemption) and starve the program's own CPU and wall guards once its server is gone; DP code never
  // needs it. (This replaces the old "ignores SIGTERM" test: a program can no longer ignore signals.)
  it('R5: importing os/signal is a compile_error at the import line, and nothing runs', async () => {
    const r = await run(`package main
import (
	"os/signal"
	"syscall"
)
func numDecodings(s string) int {
	signal.Ignore(syscall.SIGTERM, syscall.SIGURG, syscall.SIGXCPU)
	for {}
}
`)
    expect(r.status).toBe('compile_error')
    expect(r.errors).toEqual([{ line: 3, col: 0, message: 'import "os/signal" is not available in Dojo' }])
    await healthy()
  }, T)

  it('disk filling: one big file in the temp dir is stopped at 64 MiB', async () => {
    const r = await run(`package main
import ("fmt"; "os")
func numDecodings(s string) int {
	f, _ := os.Create("big")
	b := make([]byte, 1<<20)
	for i := 0; i < 2048; i++ { if _, err := f.Write(b); err != nil { fmt.Println("write:", err); break } }
	return 0
}
`)
    expect(r.status).toBe('runtime_error')
    expect(r.errors[0].message).toMatch(/64 MiB/)
    await healthy()
  }, T)

  it('disk filling: many files in the temp dir are stopped at 64 MiB in total', async () => {
    const r = await run(`package main
import ("fmt"; "os")
func numDecodings(s string) int {
	b := make([]byte, 8<<20)
	for i := 0; i < 400; i++ { if err := os.WriteFile(fmt.Sprint("f", i), b, 0o644); err != nil { fmt.Println("write:", err); break } }
	select {}
}
`)
    expect(r.status).toBe('runtime_error')
    expect(r.errors[0].message).toMatch(/64 MiB/)
    await healthy()
  }, T)

  it('disk filling: a huge static array is a compile error, not a giant binary', async () => {
    const r = await run('package main\nvar big = [1 << 30]byte{1: 1}\nfunc numDecodings(s string) int { return int(big[1]) }\n')
    expect(['compile_error', 'runtime_error', 'memory_limit']).toContain(r.status)
    await healthy()
  }, 90_000)

  it('//go:embed outside the module, cgo, extra files and go.mod tricks are compile errors', async () => {
    const cases: [string, RegExp][] = [
      ['package main\nimport _ "embed"\n//go:embed ../../../../etc/passwd\nvar x string\nfunc numDecodings(s string) int { return len(x) }\n', /embed|pattern/i],
      ['package main\nimport _ "embed"\n//go:embed /etc/passwd\nvar x string\nfunc numDecodings(s string) int { return len(x) }\n', /embed|pattern/i],
      ['package main\n// int f() { return 1; }\nimport "C"\nfunc numDecodings(s string) int { return 0 }\n', /cgo/i],
      ['//go:build ignore\n\npackage main\nfunc numDecodings(s string) int { return 0 }\n', /./],
      ['module evil\nreplace dojo/tk => /etc\n', /./],
      ['package main\nimport "dojo/tk/internal/wire"\nvar _ = wire.Frame\nfunc numDecodings(s string) int { return 0 }\n', /internal/],
      ['package main\nimport _ "unsafe"\n//go:linkname nanotime runtime.nanotime\nfunc nanotime() int64\nfunc numDecodings(s string) int { return 0 }\n', /linkname/],
    ]
    for (const [code, msg] of cases) {
      const r = await run(code)
      expect(r.status, code).toBe('compile_error')
      expect(r.errors.map(e => e.message).join(' '), code).toMatch(msg)
    }
    await healthy()
  }, 120_000)

  it('SEC-D-02: no hard links (not even into the temp dir), no kernel-control or unix-domain sockets, no POSIX IPC', async () => {
    const secret = join(s.home, 'secret.txt')
    writeFileSync(secret, 'from DOJO_HOME')
    const r = await run(`package main
import ("fmt"; "os"; "syscall"; "unsafe")
func numDecodings(s string) int {
	os.WriteFile("mine", []byte("x"), 0o644)
	fmt.Println("link-own:", os.Link("mine", "mine2"))
	fmt.Println("link-home:", os.Link(${JSON.stringify(secret)}, "stolen"))
	_, err := os.ReadFile("stolen")
	fmt.Println("read-stolen:", err != nil)
	_, err = os.ReadFile(${JSON.stringify(secret)})
	fmt.Println("read-home:", err != nil)
	_, err = syscall.Socket(32, syscall.SOCK_DGRAM, 2) // AF_SYSTEM, SYSPROTO_CONTROL: kernel controls and events
	fmt.Println("af-system:", err)
	fd, _ := syscall.Socket(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	fmt.Println("unix-connect:", syscall.Connect(fd, &syscall.SockaddrUnix{Name: "/var/run/mDNSResponder"}))
	name := []byte("/dojo-ipc-probe\\x00")
	p := uintptr(unsafe.Pointer(&name[0]))
	_, _, e := syscall.Syscall(266, p, uintptr(syscall.O_CREAT|syscall.O_EXCL|syscall.O_RDWR), 0o600) // shm_open
	fmt.Println("shm_open:", e)
	if e == 0 { syscall.Syscall(267, p, 0, 0) } // shm_unlink: never leave one behind if the deny ever fails
	_, _, e = syscall.Syscall6(268, p, uintptr(syscall.O_CREAT|syscall.O_EXCL), 0o600, 1, 0, 0) // sem_open
	fmt.Println("sem_open:", e)
	if e == 0 { syscall.Syscall(270, p, 0, 0) } // sem_unlink
	return 0
}
`)
    expect(r.status, JSON.stringify(r.errors)).toBe('ok')
    expect(r.stdout).toMatch(/link-own: link mine mine2: operation not permitted/)
    expect(r.stdout).toMatch(/link-home: link .*: operation not permitted/)
    expect(r.stdout).toContain('read-stolen: true')
    expect(r.stdout).toContain('read-home: true')
    expect(r.stdout).toMatch(/af-system: operation not permitted/)
    expect(r.stdout).toMatch(/unix-connect: operation not permitted/)
    expect(r.stdout).toMatch(/shm_open: operation not permitted/)
    expect(r.stdout).toMatch(/sem_open: operation not permitted/)
    await healthy()
  }, T)

  it('SEC-D-02: nothing under /Users, /Volumes, other apps\' temp dirs or /private/tmp is readable; the run\'s own dir is', async () => {
    const r = await run(`package main
import ("fmt"; "os")
func numDecodings(s string) int {
	for _, p := range []string{"/Users", "/Users/Shared", "/Volumes", "/private/var/folders", "/private/tmp", "/tmp/"} {
		_, err := os.ReadDir(p)
		fmt.Println("dir", p, err != nil)
	}
	os.WriteFile("own", []byte("ok"), 0o644)
	b, err := os.ReadFile("own")
	fmt.Println("own:", string(b), err)
	return 0
}
`)
    expect(r.status, JSON.stringify(r.errors)).toBe('ok')
    for (const p of ['/Users', '/Users/Shared', '/Volumes', '/private/var/folders', '/private/tmp', '/tmp/']) expect(r.stdout).toContain(`dir ${p} true`)
    expect(r.stdout).toContain('own: ok <nil>')
    await healthy()
  }, T)

  it('H2: learner code cannot read other processes\' info or host sysctls, and Go still runs goroutines', async () => {
    const r = await run(`package main
import ("fmt"; "syscall"; "unsafe"; "runtime")
func numDecodings(s string) int {
	buf := make([]byte, 4096)
	_, _, e := syscall.Syscall6(336, 2, uintptr(${s.child.pid}), 3, 0, uintptr(unsafe.Pointer(&buf[0])), uintptr(len(buf)))
	fmt.Println("procinfo:", e)
	_, err := syscall.Sysctl("kern.boottime")
	fmt.Println("boottime:", err)
	_, err = syscall.Sysctl("kern.hostname")
	fmt.Println("hostname:", err)
	done := make(chan int)
	for i := 0; i < 8; i++ { go func() { x := 0; for j := 0; j < 1000000; j++ { x += j }; done <- x }() }
	for i := 0; i < 8; i++ { <-done }
	fmt.Println("cpus:", runtime.NumCPU() > 0)
	return 0
}
`)
    expect(r.status).toBe('ok')
    expect(r.stdout).toMatch(/procinfo: operation not permitted/)
    expect(r.stdout).toMatch(/boottime: operation not permitted/)
    expect(r.stdout).toMatch(/hostname: operation not permitted/)
    expect(r.stdout).toContain('cpus: true')
    await healthy()
  }, T)
})

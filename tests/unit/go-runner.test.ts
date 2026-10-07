// @vitest-environment node
// C-RUNNER §1–§3: packs, the generated harness, the parsers, the toolkit and the sandboxed run.
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, realpathSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  callText, functionLine, goLiteral, harnessMain, LIMITS, loadPacks, PACK_IDS, parseCompileErrors, parseEvents, parseResults, prepareSource, RAW_IMPORT_MESSAGE, refusedDirectives, removeTree, crashMessage, treeUsage,
  buildProfile, createRunner, publicPack, resolveGo, runGo, sandboxProfile, stackLine, TK_DIR, wireLimits, type Pack,
} from '../../server/runner/runner.mjs'

const packs = loadPacks()
const p91 = packs.get('p91') as Pack

describe('packs (§1)', () => {
  it('the five Part 4a packs keep the pinned signatures and cases in order (C-VISUAL adds 15: visual-runner.test.ts)', () => {
    expect([...packs.keys()].sort()).toEqual([...PACK_IDS].sort())
    const table: Record<string, [string, [unknown[], unknown][]]> = {
      p91: ['func numDecodings(s string) int', [[['12'], 2], [['226'], 3], [['06'], 0], [['11106'], 2], [['2611055971756562'], 4]]],
      p198: ['func rob(nums []int) int', [[[[1, 2, 3, 1]], 4], [[[2, 7, 9, 3, 1]], 12], [[[2, 1, 1, 2]], 4], [[[0]], 0], [[[5, 1, 1, 5]], 10]]],
      p322: ['func coinChange(coins []int, amount int) int', [[[[1, 2, 5], 11], 3], [[[2], 3], -1], [[[1], 0], 0], [[[186, 419, 83, 408], 6249], 20], [[[2, 5, 10, 1], 27], 4]]],
      p62: ['func uniquePaths(m int, n int) int', [[[3, 7], 28], [[3, 2], 3], [[1, 1], 1], [[7, 3], 28], [[10, 10], 48620]]],
      p1143: ['func longestCommonSubsequence(text1 string, text2 string) int', [[['abcde', 'ace'], 3], [['abc', 'abc'], 3], [['abc', 'def'], 0], [['bsbininm', 'jmjkbkjkv'], 1], [['oxcpqrsvwf', 'shmtulqrypy'], 2]]],
    }
    for (const [id, [sig, cases]] of Object.entries(table)) {
      const p = packs.get(id) as Pack
      expect(p.signature).toBe(sig)
      expect(p.cases.map(c => [c.args, c.expected])).toEqual(cases)
      expect(p.starter).toContain(sig)
      expect(p.ref.startsWith('// dojo-ref\n')).toBe(true)
    }
  })

  it('publicPack never carries the reference', () => {
    for (const p of packs.values()) {
      const pub = JSON.stringify(publicPack(p))
      expect(pub).not.toContain('dojo-ref')
      expect(pub).not.toContain(p.ref.split('\n').slice(3, 6).join('\n'))
      expect(publicPack(p).cases).toHaveLength(5)
      expect(publicPack(p).examples).toBe(2)
    }
  })

  it('shows each input as a call', () => {
    expect(callText(p91, ['226'])).toBe('numDecodings("226")')
    expect(publicPack(packs.get('p322') as Pack).cases[0]).toEqual({ id: 1, call: 'coinChange([1,2,5], 11)', expected: 3 })
    expect(publicPack(packs.get('p1143') as Pack).cases[0].call).toBe('longestCommonSubsequence("abcde", "ace")')
    expect(publicPack(packs.get('p62') as Pack).cases[0].call).toBe('uniquePaths(3, 7)')
  })
})

describe('source and harness', () => {
  it('adds package main only when the code has no package clause, and reports the offset', () => {
    expect(prepareSource('package main\nfunc f() {}')).toEqual({ source: 'package main\nfunc f() {}', offset: 0 })
    expect(prepareSource('// note\n/* x */\npackage main\n').offset).toBe(0)
    expect(prepareSource('func f() {}')).toEqual({ source: 'package main\nfunc f() {}', offset: 1 })
  })

  it('I1: prepareSource is linear (no ReDoS on comment runs)', () => {
    for (const evil of ['/* */ '.repeat(26), '/* */ '.repeat(20_000), '// x\n'.repeat(20_000), '/*'.repeat(30_000), ' \n\t'.repeat(20_000) + 'x', '/* '.repeat(20_000) + '*/']) {
      const t0 = performance.now()
      const r = prepareSource(evil)
      expect(performance.now() - t0, evil.slice(0, 12)).toBeLessThan(50)
      expect(r.offset).toBe(1)
    }
    expect(prepareSource('/* a */ // b\n /* c\n d */\n\tpackage main\n').offset).toBe(0)
    expect(prepareSource('/* package main */\nfunc f() {}').offset).toBe(1)
    expect(prepareSource('// package main\nfunc f() {}').offset).toBe(1)
    expect(prepareSource('packagemain').offset).toBe(1)
    expect(prepareSource('package\tmain').offset).toBe(0)
  })

  it('makes Go literals for every pack type', () => {
    expect(goLiteral('int', 5)).toBe('5')
    expect(goLiteral('[]int', [1, 2])).toBe('[]int{1, 2}')
    expect(goLiteral('string', 'a"b')).toBe('"a\\"b"')
    expect(goLiteral('[][]int', [[1], [2, 3]])).toBe('[][]int{{1}, {2, 3}}')
  })

  it('generates a main that calls the function once per case', () => {
    const src = harnessMain(packs.get('p322') as Pack, (packs.get('p322') as Pack).cases.slice(0, 2))
    expect(src).toContain('\t\tfunc() string { return dojo_int(coinChange([]int{1, 2, 5}, 11)) },\n\t\tfunc() string { return dojo_int(coinChange([]int{2}, 3)) },\n\t})')
    expect(src.match(/func\(\) string \{ return/g)).toHaveLength(2)
    expect(src).toContain('dojo_tk.DojoHarness([]func() string{')
    // security M1: nothing in package main writes to the runner's pipes
    expect(src).not.toMatch(/NewFile|os"/)
  })

  it('maps compile errors to the learner\'s lines', () => {
    const out = '# dojo\n./solution.go:5:9: undefined: x\n./solution.go:7: syntax error: unexpected }\n./dojo_main.go:120:40: undefined: numDecodings\n'
    expect(parseCompileErrors(out, 1, 3)).toEqual([
      { line: 4, col: 9, message: 'undefined: x' },
      { line: 6, col: 0, message: 'syntax error: unexpected }' },
      { line: 3, col: 0, message: 'Dojo could not call your function: undefined: numDecodings' },
    ])
    expect(parseCompileErrors(out, 1, 3, { pack: p91 }).at(-1)).toEqual({ line: 3, col: 0, message: 'Define a function named numDecodings: func numDecodings(s string) int' })
    expect(parseCompileErrors('solution.go:3:8: package foo/bar is not in std\n', 0)).toEqual([{ line: 3, col: 8, message: 'package foo/bar is not in std' }])
  })

  it('L4: any dojo_ helper name left in a message is stripped', () => {
    const ctx = { tmp: '/t', pack: p91, code: 'package main\nfunc numDecodings(s string) int { return 0 }\n' }
    const out = [
      './dojo_main.go:64:35: cannot use x (variable of type float64) as string value in argument to dojo_strconv.Itoa',
      './dojo_main.go:65:35: undefined: dojo_tk.Something',
      './dojo_main.go:66:35: invalid operation: dojo_q(x) (mismatched types)',
    ].join('\n')
    for (const e of parseCompileErrors(out, 0, 2, ctx)) expect(e.message).not.toMatch(/dojo_/)
  })

  it('code review M1/M2: friendly messages, no internal paths, no repeats', () => {
    const tmp = '/private/var/folders/_l/x/T/dojo-run-abc123'
    const ctx = { tmp, pack: p91, code: 'package foo\nfunc main() {}\nfunc numDecodings(s string) int { return 0 }\n' }
    const out = [
      `found packages main (dojo_main.go) and foo (solution.go) in ${tmp}/mod`,
      './solution.go:2:6: main redeclared in this block',
      '\t./dojo_main.go:62:6: other declaration of main',
      './solution.go:3:8: package dojo/x is not in std (/opt/homebrew/Cellar/go/1.24.2/libexec/src/dojo/x)',
      './solution.go:4:8: package fmtx is not in std (/opt/homebrew/Cellar/go/1.24.2/libexec/src/fmtx)',
      'solution.go:4:0: finding module for package github.com/foo/bar',
      './solution.go:5:8: cannot find module providing package github.com/foo/bar: module lookup disabled by GOPROXY=off',
      'package dojo',
      '\tsolution.go:6:8: use of internal package dojo/tk/internal/wire not allowed',
      './dojo_main.go:70:40: cannot use numDecodings("12") (value of type string) as int value in argument to dojo_int',
      './dojo_main.go:71:40: cannot use numDecodings("226") (value of type string) as int value in argument to dojo_int',
      './dojo_main.go:70:40: undefined: numDecodings',
      './dojo_main.go:71:40: undefined: numDecodings',
      `${tmp}/mod/solution.go:7:2: undefined: y`,
    ].join('\n')
    const errs = parseCompileErrors(out, 0, 3, ctx)
    const text = errs.map(e => `${e.line}: ${e.message}`)
    expect(text).toEqual([
      '1: Your file must be package main',
      '2: Remove your func main: Dojo calls your function',
      '3: Unknown import dojo/x: only dojo/tk is available',
      '4: Unknown import fmtx: it is not in the standard library',
      '5: Unknown import github.com/foo/bar: only the standard library and dojo/tk are available',
      '6: Unknown import dojo/tk/internal/wire: only dojo/tk is available',
      '3: numDecodings returns string, but it must return int: func numDecodings(s string) int',
      '3: Define a function named numDecodings: func numDecodings(s string) int',
      '7: undefined: y',
    ])
    for (const e of errs) {
      expect(e.message).not.toMatch(/dojo-run-|\/var\/|\/opt\/|dojo_main|harness/)
    }
  })

  it('finds the function line and the first learner frame of a stack', () => {
    expect(functionLine('package main\n\nfunc numDecodings(s string) int {', 'numDecodings')).toBe(3)
    expect(functionLine('nothing', 'numDecodings')).toBe(1)
    expect(stackLine('main.numDecodings(...)\n\t/tmp/x/mod/solution.go:9 +0x1c', 1)).toBe(8)
    expect(stackLine('no frame', 0)).toBeNull()
  })

  it('writes a sandbox profile that denies network, exec and writes outside tmp', () => {
    const sb = sandboxProfile({ tmp: '/t/run', prog: '/t/run/prog', home: '/Users/x', dojoHome: '/d/home', appDir: '/srv/app' })
    expect(sb).toContain('(deny network*)')
    expect(sb).toContain('(deny process-fork)')
    expect(sb).toContain('(allow process-exec (literal "/t/run/prog"))')
    expect(sb).toContain('(deny signal)\n(allow signal (target self))')
    expect(sb).toContain('(deny process-info*)\n(allow process-info* (target self))')
    expect(sb).toContain('(deny sysctl-read)')
    expect(sb).toContain('(deny file-write-flags)\n(deny file-write-mode)')
    expect(sb).toContain('(deny file-write*)\n(allow file-write* (subpath "/t/run") (literal "/dev/null"))')
    expect(sb).toContain('(deny file-read* (subpath "/Users/x") (subpath "/d/home") (subpath "/srv/app") (subpath "/Users") (subpath "/Volumes") (subpath "/private/var/folders") (subpath "/private/tmp"))\n(allow file-read* (subpath "/t/run"))')
    // SEC-D-02: no Mach service, IOKit, IPC, hard link or socket of any kind
    expect(sb).toContain('(deny network*)\n(deny system-socket)\n(deny mach-lookup)\n(deny mach-register)\n(deny iokit-open)\n(deny ipc-posix*)\n(deny ipc-sysv*)\n(deny file-link)')
    expect(buildProfile({ tmp: '/t/run', cache: '/d/home/gocache', appDir: '/srv/app' })).toContain('(deny file-read* (subpath "/srv/app"))\n(allow file-read* (subpath "/t/run") (subpath "/d/home/gocache"))')
  })

  it('uses DOJO_GO_BIN when set, and nothing else', () => {
    expect(resolveGo({ DOJO_GO_BIN: '/nonexistent/go', PATH: '/opt/homebrew/bin:/usr/local/go/bin' })).toBeNull()
  })
})

describe.skipIf(process.platform !== 'darwin')('SEC-D-02: the run profile under sandbox-exec (no Go needed)', () => {
  // System tools stand in for a program that reaches launchd services by raw Mach traps: what a lookup can get to
  // is decided by the profile, whatever the caller. Each check has its control (the same profile without the deny).
  const sbx = (profile: string, argv: string[]) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'dojo-sbx-')))
    try {
      const f = join(dir, 'p.sb')
      writeFileSync(f, profile)
      return execFileSync('/usr/bin/sandbox-exec', ['-f', f, ...argv], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  const profileFor = (prog: string) => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'dojo-sbx-run-')))
    rmSync(tmp, { recursive: true, force: true })
    return sandboxProfile({ tmp, prog, home: realpathSync(homedir()) })
  }
  it('no launchd service answers a lookup (notifyd)', () => {
    const p = profileFor('/usr/bin/notifyutil')
    expect(sbx(p, ['/usr/bin/notifyutil', '-g', 'com.apple.system.timezone'])).toMatch(/Failed/)
    expect(sbx(p.replace('(deny mach-lookup)\n', ''), ['/usr/bin/notifyutil', '-g', 'com.apple.system.timezone'])).toMatch(/^com\.apple\.system\.timezone \d+/)
  })
  it('no directory service answers either (a lookup of this user)', () => {
    const p = profileFor('/usr/bin/dscacheutil')
    const me = ['/usr/bin/dscacheutil', '-q', 'user', '-a', 'name', userInfo().username]
    expect(/^uid: \d+/m.test(sbx(p, me))).toBe(false)
    expect(/^uid: \d+/m.test(sbx(p.replace('(deny mach-lookup)\n', ''), me))).toBe(true)
  })
})

describe('one instance, limits as build constants (security round 2 M-A, M-C)', () => {
  it('the profile lets the program unlink its binary but never write, replace or link it', () => {
    const sb = sandboxProfile({ tmp: '/t/run', prog: '/t/run/prog', home: '/Users/x', dojoHome: '/d/home', appDir: '/srv/app' })
    expect(sb).toContain('(allow file-write* (subpath "/t/run") (literal "/dev/null"))\n(deny file-write* (literal "/t/run/prog"))\n(allow file-write-unlink (literal "/t/run/prog"))')
  })

  it('wireLimits bakes the limits and the binary path into limits.go', () => {
    const src = wireLimits({ limits: LIMITS, prog: '/t/run/prog' })
    expect(src).toContain('package wire')
    expect(src).toContain(`maxMem        uint64 = ${LIMITS.rssBytes}`)
    expect(src).toContain(`maxGoroutines        = ${LIMITS.maxGoroutines}`)
    expect(src).toContain(`maxFileBytes  uint64 = ${LIMITS.diskBytes + 1024 * 1024}`)
    expect(src).toContain('progPath             = "/t/run/prog"')
    // R5: the program's own CPU limit and wall guard (the runner's wall limit plus the grace)
    expect(src).toContain(`cpuSoft       uint64 = ${LIMITS.cpuSoftSec}`)
    expect(src).toContain(`cpuHard       uint64 = ${LIMITS.cpuHardSec}`)
    expect(src).toContain(`wallGuardMs          = ${LIMITS.wallMs + LIMITS.wallGraceMs}`)
    // the checked-in copy has the same shape, and no binary path (a binary built from it refuses to start)
    const checkedIn = readFileSync(join(TK_DIR, 'internal', 'wire', 'limits.go'), 'utf8')
    expect(checkedIn).toContain('progPath             = ""')
    expect(checkedIn).toContain(`maxGoroutines        = ${LIMITS.maxGoroutines}`)
    expect(checkedIn).toContain(`wallGuardMs          = ${LIMITS.wallMs + LIMITS.wallGraceMs}`)
  })

  it.skipIf(!resolveGo(process.env))('wire accepts only a bare key line on fd 5 and zeroes what it read (go test)', () => {
    const d = mkdtempSync(join(tmpdir(), 'dojo-wire-test-'))
    try {
      cpSync(TK_DIR, join(d, 'tk'), { recursive: true })
      writeFileSync(join(d, 'go.mod'), 'module dojo\n\ngo 1.22\n')
      const goBin = resolveGo(process.env) as string
      const out = execFileSync(goBin, ['test', '-count=1', '-tags', 'dojo_wiretest', './tk/internal/wire/'], {
        cwd: d, encoding: 'utf8', env: { ...process.env, GOFLAGS: '-mod=mod', GOTOOLCHAIN: 'local', GOWORK: 'off', CGO_ENABLED: '0', GOTELEMETRY: 'off' },
      })
      expect(out).toMatch(/^ok\s+dojo\/tk\/internal\/wire/m)
    } finally {
      rmSync(d, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('framing (security M1)', () => {
  it('keeps only lines that start with the run key', () => {
    const key = 'k'.repeat(48)
    const wire = `${key} T 0 1 3 "dp"\nT 1 1 3 "forged"\n${key}x S 0 0 0 1 -1 0\n${key} X 4\n`
    expect(parseEvents(wire, 100, key).steps).toEqual([{ op: 'table', t: 0, rows: 1, cols: 3, name: 'dp' }, { op: 'exit', v: 4 }])
    const res = parseResults(`{"id":1,"got":2}\n{"done":true}\n${key} {"id":2,"got":3}\n`, key)
    expect([...res.byId.keys()]).toEqual([2])
    expect(res.done).toBe(false)
  })

  it('refuses //go:linkname at its line', () => {
    expect(refusedDirectives('package main\nimport _ "unsafe"\n//go:linkname k dojo/tk/internal/wire.key\n', { allowRaw: true })).toEqual([{ line: 3, col: 0, message: '//go:linkname is not allowed in Dojo' }])
    expect(refusedDirectives('package main\n// a link name\n')).toEqual([])
  })

  it('R5: refuses an import of os/signal in every spelling, at the import\'s line (it could starve the program\'s own guards)', () => {
    const msg = 'import "os/signal" is not available in Dojo'
    const at = (line: number) => [{ line, col: 0, message: msg }]
    expect(refusedDirectives('package main\nimport "os/signal"\n')).toEqual(at(2))
    expect(refusedDirectives('package main\nimport sig "os/signal"\n')).toEqual(at(2))
    expect(refusedDirectives('package main\nimport . "os/signal"\n')).toEqual(at(2))
    expect(refusedDirectives('package main\nimport (\n\t"fmt"\n\t_ "os/signal"\n)\n')).toEqual(at(4))
    expect(refusedDirectives('package main\nimport ("fmt"; "os/signal"; "syscall")\n', { allowRaw: true })).toEqual(at(2))
    expect(refusedDirectives('package main\nimport `os/signal`\n')).toEqual(at(2))
    expect(refusedDirectives('package main\nimport "os\\x2fsignal"\n')).toEqual(at(2))
    expect(refusedDirectives('package main\nimport /* x */ (\n// "os/signal"\n"os/\\u0073ignal"\n)\n')).toEqual(at(4))
    // not an import: a string, a comment, another package
    expect(refusedDirectives('package main\nimport "os"\nvar s = "os/signal"\n// import "os/signal"\n/* import "os/signal" */\n')).toEqual([])
    expect(refusedDirectives('package main\nimport ("os"; "syscall")\n', { allowRaw: true })).toEqual([])
  })

  it('SEC-D-02: refuses syscall and unsafe in every spelling, at the import\'s line, with a plain reason', () => {
    const at = (line: number, path: string) => [{ line, col: 0, message: `import "${path}" is not available: ${RAW_IMPORT_MESSAGE}` }]
    expect(RAW_IMPORT_MESSAGE).toBe('Dojo runs your code without raw system calls or unsafe memory access')
    expect(refusedDirectives('package main\nimport "syscall"\n')).toEqual(at(2, 'syscall'))
    expect(refusedDirectives('package main\nimport _ "unsafe"\n')).toEqual(at(2, 'unsafe'))
    expect(refusedDirectives('package main\nimport (\n\t"fmt"\n\tu "unsafe"\n)\n')).toEqual(at(4, 'unsafe'))
    expect(refusedDirectives('package main\nimport . `syscall`\n')).toEqual(at(2, 'syscall'))
    expect(refusedDirectives('package main\nimport "sys\\x63all"\n')).toEqual(at(2, 'syscall'))
    expect(refusedDirectives('package main\nimport "\\u0075nsafe"\n')).toEqual(at(2, 'unsafe'))
    expect(refusedDirectives('package main\nimport "syscall/js"\n')).toEqual(at(2, 'syscall/js'))
    // both refused, each at its own line; and the linkname line as before
    expect(refusedDirectives('package main\nimport _ "unsafe"\n//go:linkname k dojo/tk/internal/wire.key\nimport "syscall"\n')).toEqual([
      { line: 3, col: 0, message: '//go:linkname is not allowed in Dojo' }, ...at(2, 'unsafe'), ...at(4, 'syscall'),
    ])
    // not imports, and look-alike packages, are fine
    expect(refusedDirectives('package main\nimport ("os"; "unsafe2"; "syscalls")\nvar s = "syscall"\n// import "unsafe"\n')).toEqual([])
    expect(refusedDirectives('package main\nimport ("os"; "syscall"; "unsafe")\n', { allowRaw: true })).toEqual([])
  })
})

describe('removeTree (security M2)', () => {
  it('removes trees with read-only dirs, mode-000 dirs and immutable files, without following symlinks', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'dojo-rt-outside-'))
    const secret = join(outside, 'secret')
    writeFileSync(secret, 'x', { mode: 0o600 })
    const dir = mkdtempSync(join(tmpdir(), 'dojo-rt-'))
    mkdirSync(join(dir, 'a', 'b'), { recursive: true })
    writeFileSync(join(dir, 'a', 'b', 'f'), 'x')
    execFileSync('/usr/bin/chflags', ['uchg', join(dir, 'a', 'b', 'f')])
    mkdirSync(join(dir, 'a', 'locked'))
    chmodSync(join(dir, 'a', 'locked'), 0)
    symlinkSync(secret, join(dir, 'a', 'link'))
    chmodSync(join(dir, 'a', 'b'), 0o500)
    const logs: string[] = []
    expect(await removeTree(dir, m => logs.push(m))).toBe(true)
    expect(existsSync(dir)).toBe(false)
    expect(statSync(secret).mode & 0o777).toBe(0o600)
    rmSync(outside, { recursive: true, force: true })
  })

  it('never throws: a tree it cannot remove is logged and reported as leaked', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'dojo-rt-parent-'))
    const dir = join(parent, 'run')
    mkdirSync(dir)
    writeFileSync(join(dir, 'f'), 'x')
    chmodSync(parent, 0o500) // the parent (outside the tree) forbids removing the tree's root
    const logs: string[] = []
    try {
      expect(await removeTree(dir, m => logs.push(m))).toBe(false)
      expect(logs.join('\n')).toContain(dir)
    } finally {
      chmodSync(parent, 0o700)
      rmSync(parent, { recursive: true, force: true })
    }
  })
})

describe('crash messages and disk usage', () => {
  it('names a stack overflow, a thread flood and an early exit', () => {
    expect(crashMessage({ stderr: 'runtime: goroutine stack exceeds 67108864-byte limit\nfatal error: stack overflow\n', code: 2 })).toBe('stack overflow (infinite recursion?)')
    expect(crashMessage({ stderr: 'runtime: program exceeds 256-thread limit\nfatal error: thread exhaustion\n', code: 2 })).toBe('your program started too many OS threads')
    expect(crashMessage({ stderr: '', code: 0 })).toBe('the program stopped before every case ran (os.Exit?)')
    expect(crashMessage({ stderr: '', code: null, signal: 'SIGSEGV' })).toBe('the program exited with SIGSEGV')
  })

  it('treeUsage counts allocated bytes and stops past maxEntries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dojo-usage-'))
    writeFileSync(join(dir, 'a'), Buffer.alloc(1 << 20, 1))
    mkdirSync(join(dir, 'd'))
    for (let i = 0; i < 20; i++) writeFileSync(join(dir, 'd', String(i)), 'x')
    const u = treeUsage(dir)
    expect(u.bytes).toBeGreaterThanOrEqual(1 << 20)
    expect(u.over).toBe(false)
    expect(treeUsage(dir, 10).over).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('event parser (§3)', () => {
  it('turns wire lines into steps, with rules, deps and function names', () => {
    const wire = [
      'T 0 1 6 "dp"', 'S 0 0 1 1 -1 0', 'R 0 "{0} + {1}"', 'S 0 0 3 3 0 2 0 2 0 1', 'G 0 0 3 3',
      'L "f" "dp"', 'F 0 "f"', 'E 0 1 5', 'H 0 1 3', 'X 8', 'O "queue" 0 "push" 1 7', 'S 0 0 2',
    ].join('\n')
    expect(parseEvents(wire)).toEqual({
      truncated: false,
      steps: [
        { op: 'table', t: 0, rows: 1, cols: 6, name: 'dp' },
        { op: 'set', t: 0, i: 0, j: 1, v: 1, deps: [] },
        { op: 'set', t: 0, i: 0, j: 3, v: 3, deps: [[0, 2], [0, 1]], rule: '{0} + {1}' },
        { op: 'get', t: 0, i: 0, j: 3, v: 3 },
        { op: 'link', fn: 'f', table: 'dp' },
        { op: 'enter', fn: 'f', args: [5] },
        { op: 'hit', fn: 'f', args: [3] },
        { op: 'exit', v: 8 },
      ],
    })
  })

  it('M5: a C line marks the next event with its case and is not a step', () => {
    expect(parseEvents('C 1\nF 0 "f"\nE 0 1 5\nX 1\nC 2\nC 3\nE 0 1 6\n').steps).toEqual([
      { op: 'enter', fn: 'f', args: [5], case: 1 }, { op: 'exit', v: 1 }, { op: 'enter', fn: 'f', args: [6], case: 3 },
    ])
  })

  it('caps the steps and reports truncation', () => {
    const wire = Array.from({ length: 30 }, (_, i) => `X ${i}`).join('\n')
    const r = parseEvents(wire, 20)
    expect(r.steps).toHaveLength(20)
    expect(r.truncated).toBe(true)
    expect(parseEvents('X 1\nZ\n').truncated).toBe(true)
  })

  it('reads names with spaces and quotes', () => {
    expect(parseEvents('T 0 2 2 "my \\"dp\\" table"').steps[0]).toMatchObject({ name: 'my "dp" table' })
  })
})

// ---------------------------------------------------------------- with the Go toolchain
const goBin = resolveGo(process.env)
const withGo = goBin ? describe : describe.skip

withGo('runs (Go toolchain present)', () => {
  let home: string
  let scratch: string
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'dojo-runner-home-'))
    scratch = mkdtempSync(join(tmpdir(), 'dojo-runner-scratch-'))
  })
  afterAll(() => {
    rmSync(home, { recursive: true, force: true })
    rmSync(scratch, { recursive: true, force: true })
  })
  const run = (code: string, mode: 'run' | 'submit' = 'run', pack: Pack = p91) => runGo({ pack, code, mode }, { home })
  const T = 60_000

  it('every reference passes Submit 5/5', async () => {
    for (const p of packs.values()) {
      const r = await run(p.ref, 'submit', p)
      expect(r.status, p.id).toBe('ok')
      expect(r.cases.map(c => c.pass), p.id).toEqual([true, true, true, true, true])
    }
  }, 120_000)

  it('RN-02: a wrong answer fails case 2 with the got value', async () => {
    const r = await run('package main\n\nfunc numDecodings(s string) int {\n\tif len(s) <= 2 { return len(s) }; return len(s) + 1\n}\n')
    expect(r.status).toBe('ok')
    expect(r.cases).toEqual([
      { id: 1, call: 'numDecodings("12")', expected: 2, got: 2, pass: true },
      { id: 2, call: 'numDecodings("226")', expected: 3, got: 4, pass: false },
    ])
  }, T)

  it('RN-03: a compile error on line 4, with or without a package clause', async () => {
    const a = await run('package main\n\nfunc numDecodings(s string) int { n := len(s); _ = n\n\treturn undefinedThing\n}\n')
    expect(a.status).toBe('compile_error')
    expect(a.errors[0]).toMatchObject({ line: 4, message: 'undefined: undefinedThing' })
    const b = await run('\n\nfunc numDecodings(s string) int { n := len(s); _ = n\n\treturn undefinedThing\n}\n')
    expect(b.errors[0].line).toBe(4)
    const c = await run('package main\n\nfunc decode(s string) int { return 0 }\n')
    expect(c.status).toBe('compile_error')
    expect(c.errors[0].message).toContain('numDecodings')
  }, T)

  it('code review M1/M2: real compile errors read plainly, once, without internal paths', async () => {
    const cases: [string, string, number][] = [
      ['package foo\nfunc numDecodings(s string) int { return 0 }\n', 'Your file must be package main', 1],
      ['package main\nfunc main() {}\nfunc numDecodings(s string) int { return 0 }\n', 'Remove your func main: Dojo calls your function', 2],
      ['package main\nimport "dojo/x"\nvar _ = x.Y\nfunc numDecodings(s string) int { return 0 }\n', 'Unknown import dojo/x: only dojo/tk is available', 2],
      ['package main\nfunc numDecodings(s string) string { return "" }\n', 'numDecodings returns string, but it must return int: func numDecodings(s string) int', 2],
      ['package main\nfunc decode(s string) int { return 0 }\n', 'Define a function named numDecodings: func numDecodings(s string) int', 1],
    ]
    for (const [code, message, line] of cases) {
      const r = await run(code, 'submit')
      expect(r.status, code).toBe('compile_error')
      expect(r.errors, code).toEqual([{ line, col: expect.any(Number), message }])
      expect(JSON.stringify(r.errors)).not.toMatch(/dojo-run-|\/var\/|\/opt\/|dojo_main/)
    }
  }, 120_000)

  it('security round 2 L4: reserved names, wrong declarations and extra results read plainly, with no dojo_ helper names', async () => {
    const sig = 'func numDecodings(s string) int'
    const cases: [string, { line: number; message: string }[]][] = [
      ['package main\nfunc dojo_int(v int) string { return "" }\nfunc numDecodings(s string) int { return 0 }\n', [{ line: 2, message: "dojo_int is a reserved name in Dojo's runner" }]],
      ['package main\nvar dojo_tk = 1\nfunc numDecodings(s string) int { return 0 }\n', [{ line: 2, message: "dojo_tk is a reserved name in Dojo's runner" }]],
      ['package main\nfunc dojo_q() {}\nfunc dojo_ints() {}\nfunc numDecodings(s string) int { return 0 }\n', [{ line: 2, message: "dojo_q is a reserved name in Dojo's runner" }, { line: 3, message: "dojo_ints is a reserved name in Dojo's runner" }]],
      ['package main\ntype numDecodings int\n', [{ line: 1, message: `Define a function named numDecodings: ${sig}` }]],
      ['package main\nvar numDecodings = 3\n', [{ line: 1, message: `Define a function named numDecodings: ${sig}` }]],
      ['package main\nfunc numDecodings(s string) (int, error) { return 0, nil }\n', [{ line: 2, message: 'numDecodings returns (int, error), but it must return int' }]],
      ['package main\nfunc numDecodings(s string) { }\n', [{ line: 2, message: 'numDecodings returns nothing, but it must return int' }]],
    ]
    for (const [code, want] of cases) {
      const r = await run(code, 'submit')
      expect(r.status, code).toBe('compile_error')
      expect(r.errors.map(e => ({ line: e.line, message: e.message })), code).toEqual(want)
      if (!want[0].message.includes('reserved')) expect(JSON.stringify(r.errors), code).not.toMatch(/dojo_|dojo-run-|dojo_main/)
    }
  }, 180_000)

  it('final review L4: the learner\'s own dojo_ names are not mapped to the harness; a real collision still is', async () => {
    const fn = 'func numDecodings(s string) int { return 0 }\n'
    const cases: [string, { line: number; message: RegExp }][] = [
      [`package main\nvar dojo_x int\nvar dojo_x int\n${fn}`, { line: 3, message: /^dojo_x redeclared in this block/ }],
      [`package main\nfunc numDecodings(s string) int {\n\tdojo_total := 0\n\treturn 0\n}\n`, { line: 3, message: /^declared and not used: dojo_total$/ }],
      [`package main\nfunc numDecodings(s string) int { return dojo_missing() }\n`, { line: 2, message: /^undefined: dojo_missing$/ }],
      [`package main\nfunc dojo_int(v int) string { return "" }\n${fn}`, { line: 2, message: /^dojo_int is a reserved name in Dojo's runner$/ }],
    ]
    for (const [code, want] of cases) {
      const r = await run(code, 'submit')
      expect(r.status, code).toBe('compile_error')
      expect(r.errors[0], code).toMatchObject({ line: want.line })
      expect(r.errors[0].message, code).toMatch(want.message)
      expect(r.errors[0].message, code).not.toMatch(/Dojo helper|solution\.go|dojo_main/)
      if (!/reserved/.test(want.message.source)) expect(r.errors[0].message, code).not.toMatch(/reserved/)
    }
  }, 180_000)

  it('a panic is a runtime error at the learner\'s line', async () => {
    const r = await run('package main\n\nfunc numDecodings(s string) int { n := len(s); _ = n\n\tvar a []int\n\treturn a[n]\n}\n')
    expect(r.status).toBe('runtime_error')
    expect(r.errors[0]).toMatchObject({ line: 5 })
    expect(r.errors[0].message).toContain('index out of range')
  }, T)

  it('the toolkit streams table and call-tree events on fd 3, apart from stdout', async () => {
    const r = await run(`package main
import ("fmt"; "dojo/tk")
var memo = map[int]int{}
var str string
func f(i int) int {
	if v, ok := memo[i]; ok { tk.Hit("f", i); return v }
	tk.Enter("f", i)
	v := 0
	if i <= 1 {
		v = 1
		if i == 1 && str[0] == '0' { v = 0 }
	} else {
		if str[i-1] != '0' { v += f(i-1) }
		if two := (str[i-2]-'0')*10 + str[i-1] - '0'; str[i-2] != '0' && two <= 26 { v += f(i-2) }
	}
	memo[i] = v
	tk.Exit(v)
	return v
}
func numDecodings(s string) int { n := len(s); _ = n
	fmt.Println("hello")
	memo = map[int]int{}
	str = s
	tk.Link("f", "dp")
	t := tk.Table("dp", 1, n+1)
	t.Set(0, 0, 1, tk.Rule("base"))
	_ = t.Get(0, 0)
	return f(n)
}
`, 'submit')
    expect(r.status).toBe('ok')
    expect(r.stdout).toBe('hello\n'.repeat(5))
    expect(r.cases.every(c => c.pass)).toBe(true)
    expect(r.steps.slice(0, 5)).toEqual([
      { op: 'link', fn: 'f', table: 'dp', case: 1 },
      { op: 'table', t: 0, rows: 1, cols: 3, name: 'dp' },
      { op: 'set', t: 0, i: 0, j: 0, v: 1, deps: [], rule: 'base' },
      { op: 'get', t: 0, i: 0, j: 0, v: 1 },
      { op: 'enter', fn: 'f', args: [2] },
    ])
    expect(r.steps.some(s => s.op === 'hit')).toBe(true)
  }, T)

  it('RN-16: events are capped at 20000 and the run is marked truncated', async () => {
    const r = await run('package main\nimport "dojo/tk"\nfunc numDecodings(s string) int { n := len(s); _ = n\n\tt := tk.Table("dp", 1, 10)\n\tfor i := 0; i < 30000; i++ { t.Set(0, i%10, i) }\n\treturn 0\n}\n')
    expect(r.status).toBe('ok')
    expect(r.steps).toHaveLength(20000)
    expect(r.truncated).toBe(true)
  }, T)

  it('Addendum 1 Q5: events do not count toward the 1 MiB stdout cap', async () => {
    const r = await run('package main\nimport ("fmt"; "strings"; "dojo/tk")\nfunc numDecodings(s string) int { n := len(s); _ = n\n\tif n == 2 { fmt.Print(strings.Repeat("y", 900<<10)) }\n\tt := tk.Table("a very long table name to make each event line long", 100, 100)\n\tfor i := 0; i < 25000; i++ { t.Set(i%100, (i/100)%100, i*1000003, tk.Dep(0, 0), tk.Dep(1, 1), tk.Rule("{0} + {1} + a fairly long rule text")) }\n\treturn 0\n}\n')
    expect(r.status).toBe('ok')
    expect(r.truncated).toBe(true)
    expect(r.steps).toHaveLength(20000)
    expect(r.steps[0].op).toBe('table')
  }, T)

  it('M4: events written before a timeout are kept (written through)', async () => {
    const r = await run('package main\nimport "dojo/tk"\nfunc numDecodings(s string) int {\n\tt := tk.Table("dp", 1, 10)\n\tfor i := 0; i < 100; i++ { t.Set(0, i%10, i) }\n\tfor {}\n}\n')
    expect(r.status).toBe('timeout')
    expect(r.steps).toHaveLength(101)
  }, T)

  it('M4: events written before a stack overflow are kept', async () => {
    const r = await run('package main\nimport "dojo/tk"\nfunc f(n int) int {\n\tif n < 50 { tk.Enter("f", n) }\n\treturn f(n+1) + 1\n}\nfunc numDecodings(s string) int { return f(0) }\n')
    expect(r.status).toBe('runtime_error')
    expect(r.steps).toHaveLength(50)
    expect(r.steps[49]).toEqual({ op: 'enter', fn: 'f', args: [49] })
  }, T)

  it('M4: a recursion that hits the event cap keeps all 20000 events', async () => {
    const r = await run('package main\nimport "dojo/tk"\nfunc f(n int) int {\n\ttk.Enter("f", n)\n\treturn f(n+1) + 1\n}\nfunc numDecodings(s string) int { return f(0) }\n')
    expect(r.status).toBe('runtime_error')
    expect(r.steps).toHaveLength(20000)
    expect(r.truncated).toBe(true)
  }, T)

  it('M5: each case\'s first event carries its case id (not an extra step)', async () => {
    const r = await run('package main\nimport "dojo/tk"\nfunc numDecodings(s string) int {\n\ttk.Enter("f", len(s))\n\treturn len(s)\n}\n')
    expect(r.steps).toEqual([{ op: 'enter', fn: 'f', args: [2], case: 1 }, { op: 'enter', fn: 'f', args: [3], case: 2 }])
  }, T)

  it('M11: events dropped by the fd 3 byte cap mark the run truncated, with no half line kept', async () => {
    const r = await runGo({ pack: p91, mode: 'run', code: 'package main\nimport "dojo/tk"\nfunc numDecodings(s string) int {\n\tt := tk.Table("dp", 1, 10)\n\tfor i := 0; i < 2000; i++ { t.Set(0, i%10, 1234567 + i) }\n\treturn 0\n}\n' },
      { home, limits: { ...LIMITS, eventBytes: 4096 } })
    expect(r.status).toBe('ok')
    expect(r.truncated).toBe(true)
    expect(r.steps.length).toBeGreaterThan(10)
    expect(r.steps.length).toBeLessThan(2001)
    for (const st of r.steps.slice(1)) expect(st).toMatchObject({ op: 'set', v: expect.any(Number) })
    expect((r.steps.at(-1) as { v: number }).v).toBeGreaterThanOrEqual(1234567)
  }, T)

  it('RN-04: an infinite loop times out at 3 s and the group is killed', async () => {
    const t0 = Date.now()
    const r = await run('package main\nfunc numDecodings(s string) int { n := len(s); _ = n\n\tfor {}\n}\n')
    expect(r.status).toBe('timeout')
    expect(Date.now() - t0).toBeLessThan(10_000)
  }, T)

  it('RN-07: printing 5 MiB is an output limit', async () => {
    const r = await run('package main\nimport ("fmt"; "strings")\nfunc numDecodings(s string) int { n := len(s); _ = n\n\tfmt.Print(strings.Repeat("x", 5<<20))\n\treturn 0\n}\n')
    expect(r.status).toBe('output_limit')
    expect(r.stdout.length).toBeLessThanOrEqual(LIMITS.stdoutCap + 32)
  }, T)

  it('RN-08: 2 GiB is a memory limit, touched or not', async () => {
    const touched = await run('package main\nfunc numDecodings(s string) int { n := len(s); _ = n\n\tb := make([]byte, 2<<30)\n\tfor i := range b { b[i] = 1 }\n\treturn int(b[n])\n}\n')
    expect(touched.status).toBe('memory_limit')
    const untouched = await run('package main\nvar sink []byte\nfunc numDecodings(s string) int { n := len(s); _ = n\n\tsink = make([]byte, 2<<30)\n\treturn n\n}\n')
    expect(untouched.status).toBe('memory_limit')
  }, T)

  it('RN-05: no network and no writes outside the temp dir, and the run still completes', async () => {
    const outside = join(scratch, 'escape.txt')
    const inHome = join(homedir(), `.dojo-runner-test-${process.pid}.txt`)
    const r = await run(`package main
import ("fmt"; "net"; "os"; "time")
func numDecodings(s string) int { n := len(s); _ = n
	_, err := net.DialTimeout("tcp", "1.1.1.1:80", 2*time.Second)
	fmt.Println("dial:", err)
	fmt.Println("write:", os.WriteFile(${JSON.stringify(outside)}, []byte("x"), 0o644))
	fmt.Println("home:", os.WriteFile(${JSON.stringify(inHome)}, []byte("x"), 0o644))
	fmt.Println("tmp:", os.WriteFile(os.TempDir()+"/ok.txt", []byte("x"), 0o644))
	return n
}
`)
    expect(r.status).toBe('ok')
    expect(r.stdout).toMatch(/dial: .*operation not permitted/)
    expect(r.stdout).toMatch(/write: .*operation not permitted/)
    expect(r.stdout).toMatch(/home: .*operation not permitted/)
    expect(r.stdout).toContain('tmp: <nil>')
    expect(existsSync(outside)).toBe(false)
    expect(existsSync(inHome)).toBe(false)
  }, T)

  it('SEC-D-02: importing syscall or unsafe is a compile_error at the import line, and nothing runs', async () => {
    const r = await run(`package main
import (
	"fmt"
	"syscall"
)
func numDecodings(s string) int { fmt.Println("ran"); return syscall.Getpid() }
`)
    expect(r.status).toBe('compile_error')
    expect(r.errors).toEqual([{ line: 4, col: 0, message: `import "syscall" is not available: ${RAW_IMPORT_MESSAGE}` }])
    expect(r.stdout).toBe('')
    const u = await run('package main\nimport "unsafe"\nfunc numDecodings(s string) int { return int(unsafe.Sizeof(s)) }\n')
    expect(u.status).toBe('compile_error')
    expect(u.errors[0]).toMatchObject({ line: 2, message: expect.stringContaining('import "unsafe" is not available') })
  }, T)

  it('cannot start other programs or read DOJO_HOME', async () => {
    writeFileSync(join(home, 'writer.token'), 'secret-token')
    const r = await run(`package main
import ("fmt"; "os"; "os/exec")
func numDecodings(s string) int { n := len(s); _ = n
	_, err := exec.Command("/bin/echo", "hi").Output()
	fmt.Println("exec:", err)
	_, err = os.ReadFile(${JSON.stringify(join(home, 'writer.token'))})
	fmt.Println("read:", err)
	return n
}
`)
    expect(r.status).toBe('ok')
    expect(r.stdout).toMatch(/exec: .*operation not permitted/)
    expect(r.stdout).toMatch(/read: .*operation not permitted/)
    expect(r.stdout).not.toContain('secret-token')
  }, T)

  it('I2: with the app outside HOME, the program still cannot read the packs (ref.go) or the app dir', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dojo-outside-home-')))
    expect(root.startsWith(realpathSync(homedir()))).toBe(false)
    try {
      const app = join(root, 'app')
      cpSync(join(__dirname, '..', '..', 'server', 'runner'), join(app, 'server', 'runner'), { recursive: true })
      cpSync(join(__dirname, '..', '..', 'shared'), join(app, 'shared'), { recursive: true }) // runner.mjs imports ../../shared
      writeFileSync(join(app, 'package.json'), '{"name":"dojo"}')
      const copy = await import(pathToFileURL(join(app, 'server', 'runner', 'runner.mjs')).href) as typeof import('../../server/runner/runner.mjs')
      const ref = join(app, 'server', 'runner', 'packs', 'p91', 'ref.go')
      const r = await copy.runGo({ pack: copy.loadPacks().get('p91')!, mode: 'run', code: `package main
import ("fmt"; "os")
func numDecodings(s string) int {
	b, err := os.ReadFile(${JSON.stringify(ref)})
	fmt.Println("ref:", len(b), err)
	_, err = os.ReadFile(${JSON.stringify(join(app, 'package.json'))})
	fmt.Println("app:", err)
	_, err = os.ReadDir(${JSON.stringify(join(app, 'server', 'runner', 'packs'))})
	fmt.Println("dir:", err)
	return 0
}
` }, { home })
      expect(r.status).toBe('ok')
      expect(r.stdout).toMatch(/ref: 0 .*operation not permitted/)
      expect(r.stdout).toMatch(/app: .*operation not permitted/)
      expect(r.stdout).toMatch(/dir: .*operation not permitted/)
      expect(r.stdout).not.toContain('dojo-ref')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, T)

  it('RN-06: the environment is scrubbed (no DOJO, not the real HOME)', async () => {
    const r = await runGo({ pack: p91, code: 'package main\nimport ("fmt"; "os")\nfunc numDecodings(s string) int { n := len(s); _ = n\n\tfmt.Println(os.Environ())\n\treturn n\n}\n', mode: 'run' },
      { home, env: { ...process.env, DOJO_SECRET: 'x', DOJO_HOME: home } })
    expect(r.status).toBe('ok')
    expect(r.stdout).not.toContain('DOJO')
    expect(r.stdout).not.toContain(`HOME=${homedir()}`)
    expect(r.stdout).toContain('HOME=')
  }, T)

  it('removes its temp dir after every run', async () => {
    const r = await run('package main\nimport ("fmt"; "os")\nfunc numDecodings(s string) int { n := len(s); _ = n\n\twd, _ := os.Getwd()\n\tfmt.Print(wd)\n\treturn n\n}\n')
    const dir = r.stdout.split('\n')[0].replace(/\/home$/, '')
    expect(dir).toMatch(/dojo-run-/)
    expect(existsSync(dir)).toBe(false)
    await new Promise(r => setTimeout(r, 1500)) // nothing the build started (go's telemetry child) recreates it
    expect(existsSync(dir)).toBe(false)
  }, T)

  it('L3: a build past the build memory cap is a compile_error, "the build used too much memory"', async () => {
    const r = await runGo({ pack: p91, code: p91.ref, mode: 'run' }, { home, limits: { ...LIMITS, buildRssBytes: 1024 * 1024, buildRssPollMs: 10 } })
    expect(r.status).toBe('compile_error')
    expect(r.errors).toEqual([{ line: 1, col: 0, message: 'the build used too much memory' }])
  }, T)

  it('RN-17: a missing toolchain is no_toolchain', async () => {
    const r = await runGo({ pack: p91, code: p91.ref, mode: 'run' }, { home, env: { ...process.env, DOJO_GO_BIN: '/nonexistent/go' } })
    expect(r.status).toBe('no_toolchain')
  })

  it('GOCACHE growth: the shared cache is cleaned once it passes cacheBytes (and builds still work)', async () => {
    const h = mkdtempSync(join(tmpdir(), 'dojo-runner-cache-'))
    try {
      const limits = { ...LIMITS, cacheBytes: 4 * 1024 * 1024, cacheCheckMs: 0 }
      const logs: string[] = []
      const runner = createRunner({ home: h, limits, log: m => logs.push(m) })
      expect(runner.claim()).toBe(true)
      const r = await runner.run({ pack: p91, code: p91.ref, mode: 'run' })
      expect(r.status).toBe('ok')
      await runner.settled() // L2: the trim runs after the reply
      expect(logs.join('\n')).toMatch(/build cache .* over 4 MiB: cleaned/)
      expect(treeUsage(join(h, 'gocache'), 1e6).bytes).toBeLessThan(4 * 1024 * 1024)
      const again = await runGo({ pack: p91, code: p91.ref, mode: 'run' }, { home: h, limits: { ...limits, cacheBytes: 1 << 30 } })
      expect(again.status).toBe('ok')
    } finally {
      rmSync(h, { recursive: true, force: true })
    }
  }, 120_000)

  it('keeps the build cache under DOJO_HOME', () => {
    expect(existsSync(join(home, 'gocache'))).toBe(true)
    expect(readFileSync(join(home, 'gocache', 'README'), 'utf8')).toContain('Go build system')
  })
})

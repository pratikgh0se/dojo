// @vitest-environment node
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeArgs, claudeEnv, gitEvidence, parseEnvelope, parseOutput, resolveBin, runClaudeJob } from '../../server/claude-runner.mjs'

const ENVELOPE = JSON.stringify({ type: 'result', result: JSON.stringify({ hint: 'stub hint' }) })
const REQ = { ticket: { id: 'p200', title: 'Number of Islands', track: 'dsa' }, context: { level: 1 } }

const stubDir = () => mkdtempSync(join(tmpdir(), 'dojo-stub-'))
function stub(dir: string, body: string, name = 'claude'): string {
  const p = join(dir, name)
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}
const alive = (pid: number) => {
  try { process.kill(pid, 0); return true } catch { return false }
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('resolveBin', () => {
  it('accepts an executable path, finds a name on PATH, rejects missing and non-executable files', () => {
    const dir = stubDir()
    const p = stub(dir, 'exit 0', 'fakeclaude')
    expect(resolveBin(p, {})).toBe(p)
    expect(resolveBin('fakeclaude', { PATH: `/nonexistent:${dir}` })).toBe(p)
    expect(resolveBin('/nonexistent/claude', {})).toBeNull()
    writeFileSync(join(dir, 'plain'), 'x')
    expect(resolveBin(join(dir, 'plain'), {})).toBeNull()
  })
})

describe('claudeArgs', () => {
  it('runs print mode on Sonnet with JSON output, no tools, and the job guardrails as the system prompt', () => {
    const a = claudeArgs('hint')
    expect(a.slice(0, 5)).toEqual(['-p', '--model', 'sonnet', '--output-format', 'json'])
    expect(a[a.indexOf('--tools') + 1]).toBe('')
    expect(a[a.indexOf('--system-prompt') + 1]).toMatch(/Never output a complete solution/)
  })

  it('I1 isolates from the user\'s own Claude config: project-only settings, hooks disabled, slash commands off', () => {
    const a = claudeArgs('hint')
    expect(a).toContain('--strict-mcp-config')
    expect(a).toContain('--no-session-persistence')
    expect(a[a.indexOf('--setting-sources') + 1]).toBe('project')
    expect(JSON.parse(a[a.indexOf('--settings') + 1])).toEqual({ disableAllHooks: true })
    expect(a).toContain('--disable-slash-commands')
  })
})

describe('parseEnvelope and parseOutput', () => {
  it('takes the result string, rejects missing JSON and error envelopes', () => {
    expect(parseEnvelope(ENVELOPE)).toBe('{"hint":"stub hint"}')
    expect(() => parseEnvelope('nope')).toThrow(expect.objectContaining({ code: 'claude_failed' }))
    expect(() => parseEnvelope(JSON.stringify({ type: 'result', is_error: true, result: 'bad' }))).toThrow(expect.objectContaining({ code: 'claude_failed' }))
  })
  it('strips code fences, parses JSON and validates it', () => {
    expect(parseOutput('hint', '```json\n{"hint":"x"}\n```')).toEqual({ ok: true, output: { hint: 'x' } })
    expect(parseOutput('hint', 'not json')).toMatchObject({ ok: false })
    expect(parseOutput('hint', '{"nope":1}')).toMatchObject({ ok: false })
  })
  it('UAT cu-7 P2-1: repairs an interview turn that closed with done:true, but only when the request was a turn', () => {
    const closing = '{"say":"Thanks, that is the interview.","done":true}'
    expect(parseOutput('interview', closing, { context: { turn: 9 } })).toEqual({ ok: true, output: { say: 'Thanks, that is the interview.', done: false } })
    // the same words are a failed grade when the request WAS the final grade
    expect(parseOutput('interview', closing, { context: { final: true } })).toMatchObject({ ok: false })
    expect(parseOutput('interview', '{"done":true}', { context: { turn: 9 } })).toMatchObject({ ok: false })
  })
})

describe('runClaudeJob with a stub CLI', () => {
  it('H-62 returns the output; argv has -p and --model sonnet; cwd is a removed temp dir outside the home directory', async () => {
    const dir = stubDir()
    const log = join(dir, 'log')
    const bin = stub(dir, `printf '%s\\n' "$*" >> "$DOJO_STUB_LOG"\npwd >> "$DOJO_STUB_LOG"\ncat > /dev/null\nprintf '%s' '${ENVELOPE}'`)
    const out = await runClaudeJob('hint', REQ, { bin, timeoutMs: 5000, env: { ...process.env, DOJO_STUB_LOG: log } })
    expect(out).toEqual({ hint: 'stub hint' })
    const text = readFileSync(log, 'utf8')
    expect(text).toMatch(/(^|\s)-p(\s|$)/)
    expect(text).toMatch(/--model sonnet/)
    const cwd = text.trim().split('\n').pop() as string
    expect(cwd.startsWith(homedir() + '/')).toBe(false)
    expect(existsSync(cwd)).toBe(false)
  })

  it('H-60 a non-zero exit is claude_failed', async () => {
    const bin = stub(stubDir(), 'cat > /dev/null\nexit 1')
    await expect(runClaudeJob('hint', REQ, { bin, timeoutMs: 5000 })).rejects.toMatchObject({ code: 'claude_failed' })
  })

  // UAT r3 P2: a Dock launch without USER made `claude` miss its Keychain login ("not logged in", exit 1)
  it('fills USER and LOGNAME from the OS account when the app was started without them', async () => {
    const me = userInfo().username
    expect(claudeEnv({ PATH: '/bin' })).toEqual({ PATH: '/bin', USER: me, LOGNAME: me })
    expect(claudeEnv({ USER: 'a' })).toEqual({ USER: 'a', LOGNAME: 'a' })
    const full = { USER: 'a', LOGNAME: 'b' }
    expect(claudeEnv(full)).toBe(full)
    const dir = stubDir()
    const log = join(dir, 'log')
    const bin = stub(dir, `printf '%s %s\\n' "$USER" "$LOGNAME" > "$DOJO_STUB_LOG"\ncat > /dev/null\nprintf '%s' '${ENVELOPE}'`)
    const { USER: _u, LOGNAME: _l, ...bare } = process.env
    await runClaudeJob('hint', REQ, { bin, timeoutMs: 5000, env: { ...bare, DOJO_STUB_LOG: log } })
    expect(readFileSync(log, 'utf8').trim()).toBe(`${me} ${me}`)
  })

  it.each([
    ['stderr', 'cat > /dev/null\necho "Not logged in · Please run /login" >&2\nexit 1', 'Not logged in · Please run /login'],
    ['a JSON error envelope', `cat > /dev/null\nprintf '%s' '{"type":"result","is_error":true,"result":"Invalid API key · Please run /login"}'\nexit 1`, 'Invalid API key · Please run /login'],
    ['an exit-0 error envelope', `cat > /dev/null\nprintf '%s' '{"type":"result","is_error":true,"result":"Invalid API key · Please run /login"}'`, 'Invalid API key · Please run /login'],
  ])('UAT r3 P2: signed out on %s is claude_signed_out, with the CLI\'s words', async (_where, body, words) => {
    const bin = stub(stubDir(), body)
    await expect(runClaudeJob('hint', REQ, { bin, timeoutMs: 5000 })).rejects.toMatchObject({ code: 'claude_signed_out', message: `claude is not signed in: ${words}` })
  })

  it('UAT r3 P2: an unexplained exit asks `claude auth status`; loggedIn false is claude_signed_out, true stays claude_failed', async () => {
    const authSays = (loggedIn: boolean) => stub(stubDir(), `if [ "$1" = auth ]; then printf '{"loggedIn": ${loggedIn}}'; exit 1; fi\ncat > /dev/null\nexit 1`)
    await expect(runClaudeJob('hint', REQ, { bin: authSays(false), timeoutMs: 5000 })).rejects.toMatchObject({ code: 'claude_signed_out' })
    await expect(runClaudeJob('hint', REQ, { bin: authSays(true), timeoutMs: 5000 })).rejects.toMatchObject({ code: 'claude_failed' })
  })

  it('H-63 a result that is not JSON is retried exactly once, then invalid_output', async () => {
    const dir = stubDir()
    const log = join(dir, 'log')
    const bin = stub(dir, `echo run >> "$DOJO_STUB_LOG"\ncat > /dev/null\nprintf '%s' '{"type":"result","result":"not json"}'`)
    await expect(runClaudeJob('hint', REQ, { bin, timeoutMs: 5000, env: { ...process.env, DOJO_STUB_LOG: log } })).rejects.toMatchObject({ code: 'invalid_output' })
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(2)
  })

  it('M3 noRetry: a result that is not JSON spawns claude exactly once, then invalid_output', async () => {
    const dir = stubDir()
    const log = join(dir, 'log')
    const bin = stub(dir, `echo run >> "$DOJO_STUB_LOG"\ncat > /dev/null\nprintf '%s' '{"type":"result","result":"not json"}'`)
    await expect(runClaudeJob('hint', REQ, { bin, timeoutMs: 5000, env: { ...process.env, DOJO_STUB_LOG: log }, noRetry: true })).rejects.toMatchObject({ code: 'invalid_output' })
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(1)
  })

  it('H-61 + Review Focus 3: timeout rejects at once; a TERM-ignoring child and grandchild are gone after the grace period', async () => {
    const dir = stubDir()
    const log = join(dir, 'pids')
    const body = `trap '' TERM\necho $$ >> "$DOJO_STUB_LOG"\nsleep 5 &\necho $! >> "$DOJO_STUB_LOG"\ntouch "$DOJO_READY"\nwait`
    const bin = stub(dir, body)
    const readyFile = join(dir, 'ready')

    // Deterministic instead of a fixed guess: under the full suite's parallel load, how long this
    // machine takes to fork+exec the stub and reach its `trap '' TERM` line is not bounded by any
    // constant (Review Focus 3) - a hardcoded timeoutMs can fire before the trap installs, so
    // SIGTERM hits the default handler and kills the shell before it forks the "sleep 5" grandchild
    // (only one pid ever gets logged). Probe the SAME stub body once, waiting for its own readiness
    // signal (written right after the trap is installed and both pids are logged) to measure actual
    // current startup cost, then give the real run a timeout comfortably above that measurement.
    async function probeStartupMs(): Promise<number> {
      const probeDir = stubDir()
      const probeReady = join(probeDir, 'ready')
      const probeLog = join(probeDir, 'pids')
      const probeBin = stub(probeDir, body)
      const t0 = Date.now()
      const child = spawn(probeBin, [], {
        env: { ...process.env, DOJO_STUB_LOG: probeLog, DOJO_READY: probeReady },
        detached: true, stdio: 'ignore',
      })
      const deadline = Date.now() + 8000
      while (!existsSync(probeReady) && Date.now() < deadline) await sleep(5)
      const elapsed = Date.now() - t0
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
      return elapsed
    }
    const startupMs = await probeStartupMs()
    const timeoutMs = Math.max(300, startupMs + 500)

    const t0 = Date.now()
    await expect(runClaudeJob('hint', REQ, { bin, timeoutMs, env: { ...process.env, DOJO_STUB_LOG: log, DOJO_READY: readyFile } })).rejects.toMatchObject({ code: 'timeout' })
    expect(Date.now() - t0).toBeLessThan(timeoutMs + 1500)

    // Poll for the process group's actual death instead of a fixed sleep: SIGTERM is ignored, then
    // SIGKILL follows after KILL_GRACE_MS, and how long the OS then takes to fully reap both
    // processes under load is not bounded by any constant either - wait for the readiness signal
    // that matters here (both logged pids no longer alive), bounded by a generous cap.
    const deadline = Date.now() + 8000
    let pids: number[] = []
    while (Date.now() < deadline) {
      if (existsSync(log)) {
        pids = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(Number)
        if (pids.length === 2 && pids.every(p => !alive(p))) break
      }
      await sleep(50)
    }
    expect(pids).toHaveLength(2)
    for (const pid of pids) expect(alive(pid)).toBe(false)
  }, 20_000)
})

describe('gitEvidence', () => {
  it('reads log, show --stat and diff --stat without changing the repository', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'forge-'))
    const g = (...a: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a])
    g('init', '-q')
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    g('add', 'a.txt')
    g('commit', '-q', '-m', 'first mechanism')
    const before = execFileSync('git', ['-C', repo, 'status', '--porcelain']).toString()
    const ev = await gitEvidence(repo)
    expect(ev).toContain('first mechanism')
    expect(ev).toContain('a.txt')
    expect(execFileSync('git', ['-C', repo, 'status', '--porcelain']).toString()).toBe(before)
  })

  it('I1 every git evidence command disables fsmonitor and hooks', async () => {
    const dir = stubDir()
    const log = join(dir, 'git-log')
    writeFileSync(join(dir, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`)
    chmodSync(join(dir, 'git'), 0o755)
    const originalPath = process.env.PATH
    process.env.PATH = `${dir}:${originalPath}`
    try {
      await gitEvidence('/some/repo')
    } finally {
      process.env.PATH = originalPath
    }
    const calls = readFileSync(log, 'utf8').trim().split('\n')
    expect(calls).toHaveLength(3)
    for (const call of calls) {
      expect(call).toContain('-c core.fsmonitor=false')
      expect(call).toContain('-c core.hooksPath=/dev/null')
      // This evidence feeds an AI prompt: never let a repo-configured external diff driver or
      // textconv filter run or rewrite what we read.
      expect(call).toContain('--no-ext-diff')
      expect(call).toContain('--no-textconv')
    }
  })
})

describe('runClaude abort before start', () => {
  it('settles as aborted without creating a temp dir or spawning claude when the signal is already aborted', async () => {
    const dir = stubDir()
    const log = join(dir, 'log')
    // Would log a line and never exit on its own if actually spawned.
    const bin = stub(dir, `echo spawned >> "$DOJO_STUB_LOG"\ncat > /dev/null\nsleep 30`)
    const controller = new AbortController()
    controller.abort()
    await expect(
      runClaudeJob('hint', REQ, { bin, timeoutMs: 5000, env: { ...process.env, DOJO_STUB_LOG: log }, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' })
    expect(existsSync(log)).toBe(false)
  })
})

describe('runClaude abort', () => {
  it('I1 an aborted signal kills the child process group even though the CLI ignores TERM', async () => {
    const dir = stubDir()
    const log = join(dir, 'pids')
    const readyFile = join(dir, 'ready')
    const bin = stub(dir, `trap '' TERM\necho $$ >> "$DOJO_STUB_LOG"\nsleep 30 &\necho $! >> "$DOJO_STUB_LOG"\ntouch "$DOJO_READY"\nwait`)
    const controller = new AbortController()
    const runPromise = runClaudeJob('hint', REQ, {
      bin, timeoutMs: 20_000, env: { ...process.env, DOJO_STUB_LOG: log, DOJO_READY: readyFile }, signal: controller.signal,
    }).catch(e => e)
    const deadline = Date.now() + 8000
    while (!existsSync(readyFile) && Date.now() < deadline) await sleep(5)
    controller.abort()
    await runPromise
    // Both pids must die soon after the abort (well inside KILL_GRACE_MS + slack) - a stub that
    // naturally exits on its own 30s later would fail this bound, proving the abort actually killed it.
    const pollDeadline = Date.now() + 5000
    let pids: number[] = []
    while (Date.now() < pollDeadline) {
      if (existsSync(log)) {
        pids = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(Number)
        if (pids.length === 2 && pids.every(p => !alive(p))) break
      }
      await sleep(50)
    }
    expect(pids).toHaveLength(2)
    for (const pid of pids) expect(alive(pid)).toBe(false)
  }, 20_000)
})

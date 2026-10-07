// @vitest-environment node
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { allowedRepoPath, createHelper, JOBS, readConfig, type HelperConfig } from '../../server/helper.mjs'
import { fakeOutput } from '../../src/ai/fake'

const servers: Server[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(s => new Promise(r => s.close(() => r(null)))))
})

async function start(argv: string[] = ['--fake'], env: Record<string, string | undefined> = {}, over: Partial<HelperConfig> = {}) {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-'))
  const cfg = { ...readConfig(argv, { PATH: process.env.PATH, ...env }), projectRoot: forgeRoot, ...over }
  const s = createHelper(cfg)
  servers.push(s)
  await new Promise<void>(r => s.listen(0, '127.0.0.1', r))
  return { base: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, forgeRoot }
}
const post = (base: string, job: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/ai/${job}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })

// fetch() cannot override the Host header (it's forbidden by the fetch spec), so DNS-rebinding-style
// checks need a raw socket via node:http instead.
function raw(base: string, opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; headers: http.IncomingHttpHeaders; json: () => unknown }> {
  const url = new URL(base)
  return new Promise((resolvePromise, reject) => {
    const req = http.request(
      { host: url.hostname, port: url.port, method: opts.method ?? 'GET', path: opts.path ?? '/health', headers: opts.headers ?? {} },
      res => {
        const chunks: Buffer[] = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          resolvePromise({ status: res.statusCode as number, headers: res.headers, json: () => JSON.parse(text) })
        })
      },
    )
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}
const P200 = { id: 'p200', title: 'Number of Islands', track: 'dsa' }
const HINT = { ticket: P200, context: { level: 1 } }

function stub(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dojo-stub-'))
  const p = join(dir, 'claude')
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
  return p
}

describe('helper server, fake mode', () => {
  it('H-50 health', async () => {
    const { base, forgeRoot } = await start()
    const r = await fetch(`${base}/health`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true, mode: 'fake', model: 'sonnet', claude: 'skipped', inFlight: 0, limit: 2, jobs: ['hint', 'picture', 'diagram', 'interview', 'grade', 'solution', 'suggest_slide', 'classify'], projectRepo: forgeRoot })
    expect(JOBS).toHaveLength(8)
  })

  it('H-51 hint returns the app fake output in the envelope', async () => {
    const { base } = await start()
    const r = await post(base, 'hint', HINT)
    expect(r.status).toBe(200)
    const b = await r.json()
    expect(b).toMatchObject({ ok: true, job: 'hint', ticketId: 'p200', mode: 'fake', ms: expect.any(Number) })
    expect(b.output).toEqual(fakeOutput('hint', HINT as never))
    expect(b.output.hint).toMatch(/^\[fake:hint\].*p200/)
  })

  it('H-52 every job succeeds with its fake output', async () => {
    const { base } = await start()
    const bodies: Record<string, unknown> = {
      picture: { ticket: P200, context: { language: 'python' } },
      diagram: { ticket: { id: 'd-method', title: 'The method', track: 'design' }, context: { deepDives: ['a', 'b', 'c', 'd'] } },
      interview: { ticket: { id: 'd-method', title: 'The method', track: 'design' }, context: { turn: 0, answers: [], deepDives: [] } },
      grade: { ticket: { id: 'stage-00', title: 'Stage 0', track: 'ai' }, context: {} },
      solution: { ticket: P200, context: { gave_up: true } },
      suggest_slide: { ticket: null, context: { count: 1, tickets: ['a', 'b', 'c'].map(id => ({ id, title: id, track: 'ai', estMin: 50, slidCount: 0 })) } },
      classify: { context: { input: 'https://leetcode.com/problems/number-of-islands/' } },
    }
    for (const [job, body] of Object.entries(bodies)) {
      const r = await post(base, job, body)
      expect(r.status, job).toBe(200)
      expect((await r.json()).output, job).toEqual(fakeOutput(job as never, { ticket: null, ...(body as object) } as never))
    }
  })

  it('H-53 validation', async () => {
    const { base } = await start()
    const code = async (r: Response) => (await r.json()).error.code
    let r = await post(base, 'hint', { ticket: P200, context: { level: 3 } })
    expect([r.status, await code(r)]).toEqual([400, 'bad_request'])
    r = await post(base, 'hint', { context: { level: 1 } })
    expect(r.status).toBe(400)
    r = await post(base, 'solution', { ticket: P200, context: {} })
    expect([r.status, await code(r)]).toEqual([403, 'guardrail'])
    r = await post(base, 'nope', HINT)
    expect([r.status, await code(r)]).toEqual([404, 'unknown_job'])
    r = await fetch(`${base}/ai/hint`)
    expect([r.status, await code(r)]).toEqual([405, 'method_not_allowed'])
    r = await fetch(`${base}/x`)
    expect([r.status, await code(r)]).toEqual([404, 'unknown_route'])
    r = await post(base, 'hint', JSON.stringify({ ...HINT, pad: 'x'.repeat(70 * 1024) }))
    expect([r.status, await code(r)]).toEqual([413, 'too_large'])
    r = await post(base, 'hint', '{nope')
    expect([r.status, await code(r)]).toEqual([400, 'bad_request'])
  })

  it('H-54 grade repoPath must be the forge root or inside it', async () => {
    const { base, forgeRoot } = await start()
    mkdirSync(join(forgeRoot, 'stages'))
    const grade = (repoPath: string) => post(base, 'grade', { ticket: { id: 's0', title: 'S0', track: 'ai' }, context: { repoPath } })
    for (const bad of [`${forgeRoot}ry`, `${forgeRoot}/../other`, '/etc', 'relative/forge']) {
      const r = await grade(bad)
      expect([r.status, (await r.json()).error.code], bad).toEqual([400, 'path_not_allowed'])
    }
    expect((await grade(forgeRoot)).status).toBe(200)
    expect((await grade(join(forgeRoot, 'stages'))).status).toBe(200)
  })

  it('G6: with no project repo set (the default) any repoPath is path_not_allowed, and /health reports projectRepo null', async () => {
    const { base, forgeRoot } = await start(['--fake'], {}, { projectRoot: null })
    const r = await post(base, 'grade', { ticket: { id: 's0', title: 'S0', track: 'ai' }, context: { repoPath: forgeRoot } })
    expect([r.status, (await r.json()).error.code]).toEqual([400, 'path_not_allowed'])
    expect((await post(base, 'grade', { ticket: { id: 's0', title: 'S0', track: 'ai' }, context: {} })).status).toBe(200)
    expect((await (await fetch(`${base}/health`)).json()).projectRepo).toBeNull()
  })

  it('G6: readConfig takes the project repo from DOJO_PROJECT_REPO, else DOJO_HOME/profile.json, else none', () => {
    const home = mkdtempSync(join(tmpdir(), 'dojo-home-'))
    expect(readConfig([], { PATH: process.env.PATH }).projectRoot).toBeNull()
    expect(readConfig([], { DOJO_HOME: home }).projectRoot).toBeNull()
    writeFileSync(join(home, 'profile.json'), JSON.stringify({ projectRepo: '~/projects/capstone' }))
    expect(readConfig([], { DOJO_HOME: home, HOME: '/Users/learner' }).projectRoot).toBe('/Users/learner/projects/capstone')
    expect(readConfig([], { DOJO_HOME: home, DOJO_PROJECT_REPO: '/srv/repo' }).projectRoot).toBe('/srv/repo')
  })

  it('allowedRepoPath expands ~ against the real forge root', () => {
    const home = homedir()
    const root = join(home, 'projects', 'forge')
    expect(allowedRepoPath('~/projects/forge', root, home)).not.toBeNull()
    expect(allowedRepoPath('~/projects/forgery', root, home)).toBeNull()
    expect(allowedRepoPath('~/projects/forge/../other', root, home)).toBeNull()
    expect(allowedRepoPath('~/projects/forge', null, home)).toBeNull() // G6: no project repo set
  })

  it('H-55 CORS for allow-listed Dojo app origins only', async () => {
    const { base } = await start()
    const pre = await fetch(`${base}/ai/hint`, { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:8792' } })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:8792')
    expect(pre.headers.get('access-control-allow-methods')).toBe('GET, POST')
    expect(pre.headers.get('access-control-allow-headers')).toBe('Content-Type, X-Dojo-Writer') // SEC-D-06
    const r = await post(base, 'hint', HINT, { Origin: 'http://127.0.0.1:8792' })
    expect(r.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:8792')
    const evil = await post(base, 'hint', HINT, { Origin: 'https://example.com' })
    expect(evil.headers.get('access-control-allow-origin')).toBeNull()
    expect(evil.status).toBe(403)
  })

  describe('C1 security: Host pinning, Origin allow-list, JSON-only POST', () => {
    it('rejects a Host header that is not exactly 127.0.0.1:<port> or localhost:<port> (DNS rebinding)', async () => {
      const { base } = await start()
      const { port } = new URL(base)
      for (const host of [`evil.example:${port}`, `127.0.0.1.evil.com:${port}`, `127.0.0.1:${Number(port) + 1}`, '127.0.0.1']) {
        const r = await raw(base, { headers: { Host: host } })
        expect([host, r.status]).toEqual([host, 403])
      }
      const ok = await raw(base, { headers: { Host: `127.0.0.1:${port}` } })
      expect(ok.status).toBe(200)
      const okName = await raw(base, { headers: { Host: `localhost:${port}` } })
      expect(okName.status).toBe(200)
    })

    it('rejects a POST whose Origin is not in the allow-list, even without a preflight', async () => {
      const { base } = await start()
      const r = await post(base, 'hint', HINT, { Origin: 'https://attacker.example' })
      expect(r.status).toBe(403)
    })

    it('allows the Dojo app ports (8787, 8790-8798) on both 127.0.0.1 and localhost', async () => {
      const { base } = await start()
      for (const host of ['http://127.0.0.1', 'http://localhost']) {
        for (const port of [8787, 8790, 8793, 8796, 8797, 8798]) {
          const r = await post(base, 'hint', HINT, { Origin: `${host}:${port}` })
          expect([`${host}:${port}`, r.status]).toEqual([`${host}:${port}`, 200])
        }
      }
      const r8799 = await post(base, 'hint', HINT, { Origin: 'http://127.0.0.1:8799' })
      expect(r8799.status).toBe(403)
    })

    it('extends the allow-list via DOJO_HELPER_ORIGINS (comma-separated origins)', async () => {
      const { base } = await start(['--fake'], { DOJO_HELPER_ORIGINS: 'http://127.0.0.1:5173,http://localhost:5173' })
      const r = await post(base, 'hint', HINT, { Origin: 'http://127.0.0.1:5173' })
      expect(r.status).toBe(200)
      const r2 = await post(base, 'hint', HINT, { Origin: 'http://localhost:5173' })
      expect(r2.status).toBe(200)
      const stillBlocked = await post(base, 'hint', HINT, { Origin: 'http://127.0.0.1:9999' })
      expect(stillBlocked.status).toBe(403)
    })

    it('OPTIONS only answers allow-listed origins; a disallowed origin preflight is 403', async () => {
      const { base } = await start()
      const bad = await fetch(`${base}/ai/hint`, { method: 'OPTIONS', headers: { Origin: 'https://attacker.example' } })
      expect(bad.status).toBe(403)
      expect(bad.headers.get('access-control-allow-origin')).toBeNull()
      const noOrigin = await fetch(`${base}/ai/hint`, { method: 'OPTIONS' })
      expect(noOrigin.status).toBe(204)
    })

    it('requests with no Origin header (tests/curl) still work', async () => {
      const { base } = await start()
      const r = await post(base, 'hint', HINT)
      expect(r.status).toBe(200)
      expect(r.headers.get('access-control-allow-origin')).toBeNull()
    })

    it('415 unsupported_media_type when POST Content-Type is not application/json (forces a browser preflight)', async () => {
      const { base } = await start()
      const r = await raw(base, { method: 'POST', path: '/ai/hint', headers: { Host: new URL(base).host, 'Content-Type': 'text/plain' }, body: JSON.stringify(HINT) })
      expect(r.status).toBe(415)
      expect((r.json() as { error: { code: string } }).error.code).toBe('unsupported_media_type')
      const missing = await raw(base, { method: 'POST', path: '/ai/hint', headers: { Host: new URL(base).host }, body: JSON.stringify(HINT) })
      expect(missing.status).toBe(415)
      const ok = await raw(base, { method: 'POST', path: '/ai/hint', headers: { Host: new URL(base).host, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(HINT) })
      expect(ok.status).toBe(200)
    })
  })

  it('H-56 at most two in flight; the third is 429 busy at once', async () => {
    const { base } = await start()
    const t0 = Date.now()
    const slow = { 'X-Dojo-Fake-Delay-Ms': '600' }
    const calls = [post(base, 'hint', HINT, slow), post(base, 'hint', HINT, slow)]
    await new Promise(r => setTimeout(r, 50))
    const third = await post(base, 'hint', HINT, slow)
    expect(third.status).toBe(429)
    expect((await third.json()).error.code).toBe('busy')
    expect(Date.now() - t0).toBeLessThan(300)
    expect((await (await fetch(`${base}/health`)).json()).inFlight).toBe(2)
    expect((await Promise.all(calls)).map(r => r.status)).toEqual([200, 200])
    expect((await (await fetch(`${base}/health`)).json()).inFlight).toBe(0)
  })

  it('H-57 X-Dojo-Fake-Fail maps to the status table and the server keeps answering', async () => {
    const { base } = await start()
    for (const [c, s] of [['timeout', 504], ['claude_missing', 503], ['claude_signed_out', 503], ['claude_failed', 502], ['busy', 429], ['invalid_output', 502]] as const) {
      const r = await post(base, 'hint', HINT, { 'X-Dojo-Fake-Fail': c })
      expect(r.status, c).toBe(s)
      expect((await r.json()).error).toEqual({ code: c, message: 'fake hint unavailable' })
    }
    expect((await fetch(`${base}/health`)).status).toBe(200)
  })

  it('never names the private reference repository', () => {
    const name = ['forge', 'ref'].join('-')
    for (const f of ['server/helper.mjs', 'server/claude-runner.mjs', 'server/shared-entry.ts', 'server/gen/ai-shared.mjs']) {
      expect(readFileSync(f, 'utf8'), f).not.toContain(name)
    }
  })
})

describe('helper server, real mode with a stub CLI', () => {
  it('H-59 missing CLI: health says missing, POST is 503 claude_missing', async () => {
    const { base } = await start([], { DOJO_CLAUDE_BIN: '/nonexistent/claude' })
    expect((await (await fetch(`${base}/health`)).json())).toMatchObject({ mode: 'claude', claude: 'missing' })
    const r = await post(base, 'hint', HINT)
    expect([r.status, (await r.json()).error.code]).toEqual([503, 'claude_missing'])
    expect((await fetch(`${base}/health`)).status).toBe(200)
  })

  it('H-60 exit 1 is 502 claude_failed; H-62 success is 200 with mode claude', async () => {
    let s = await start([], { DOJO_CLAUDE_BIN: stub('cat > /dev/null\nexit 1') })
    let r = await post(s.base, 'hint', HINT)
    expect([r.status, (await r.json()).error.code]).toEqual([502, 'claude_failed'])
    const env = JSON.stringify({ type: 'result', result: JSON.stringify({ hint: 'stub hint' }) })
    s = await start([], { DOJO_CLAUDE_BIN: stub(`cat > /dev/null\nprintf '%s' '${env}'`) })
    r = await post(s.base, 'hint', HINT)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ ok: true, mode: 'claude', output: { hint: 'stub hint' } })
  })

  it('H-61 timeout is 504 within 3 s', async () => {
    const { base } = await start([], { DOJO_CLAUDE_BIN: stub('sleep 5'), DOJO_HELPER_TIMEOUT_MS: '500' })
    const t0 = Date.now()
    const r = await post(base, 'hint', HINT)
    expect([r.status, (await r.json()).error.code]).toEqual([504, 'timeout'])
    expect(Date.now() - t0).toBeLessThan(3000)
  })

  it('I1 a client disconnect kills the child process group and releases inFlight once it is dead', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dojo-stub-'))
    const log = join(dir, 'pids')
    const readyFile = join(dir, 'ready')
    const p = join(dir, 'claude')
    writeFileSync(p, `#!/bin/sh\ntrap '' TERM\necho $$ >> "$DOJO_STUB_LOG"\nsleep 30 &\necho $! >> "$DOJO_STUB_LOG"\ntouch "$DOJO_READY"\nwait\n`)
    chmodSync(p, 0o755)
    const { base } = await start([], { DOJO_CLAUDE_BIN: p, DOJO_STUB_LOG: log, DOJO_READY: readyFile })
    const url = new URL(`${base}/ai/hint`)
    const clientReq = http.request({ host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'Content-Type': 'application/json' } })
    clientReq.on('error', () => { /* destroyed on purpose */ })
    clientReq.end(JSON.stringify(HINT))
    const deadline = Date.now() + 8000
    while (!existsSync(readyFile) && Date.now() < deadline) await new Promise(r => setTimeout(r, 5))
    clientReq.destroy()
    const pollDeadline = Date.now() + 5000
    let pids: number[] = []
    const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
    while (Date.now() < pollDeadline) {
      if (existsSync(log)) {
        pids = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(Number)
        if (pids.length === 2 && pids.every(pid => !alive(pid))) break
      }
      await new Promise(r => setTimeout(r, 50))
    }
    expect(pids).toHaveLength(2)
    for (const pid of pids) expect(alive(pid)).toBe(false)
    expect((await (await fetch(`${base}/health`)).json()).inFlight).toBe(0)
  }, 20_000)
})

describe('CLI entry', () => {
  it('H-58 binds 127.0.0.1 and serves /health in fake mode', async () => {
    const child = spawn(process.execPath, ['server/helper.mjs', '--fake'], { env: { ...process.env, DOJO_HELPER_PORT: '0' } })
    try {
      const line = await new Promise<string>((resolve, reject) => {
        child.stdout.on('data', d => resolve(String(d)))
        child.on('exit', c => reject(new Error(`exited ${c}`)))
      })
      const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(line)
      expect(m).not.toBeNull()
      expect((await (await fetch(`http://127.0.0.1:${m![1]}/health`)).json()).mode).toBe('fake')
    } finally {
      child.kill('SIGTERM')
    }
  })
})

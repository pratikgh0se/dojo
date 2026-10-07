// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { homedir, networkInterfaces, tmpdir } from 'node:os'
import { connect } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDojoServer, readServerConfig } from '../../server/dojo-server.mjs'
import { appCsp } from '../../server/csp.mjs'

let home: string
let dist: string
let s: ReturnType<typeof createDojoServer>
let base = ''

async function start(env: Record<string, string> = {}) {
  const cfg = readServerConfig(['--fake', '--dist', dist], { DOJO_HOME: home, DOJO_PORT: '0', ...env })
  s = createDojoServer(cfg)
  base = `http://127.0.0.1:${await s.listen(0)}`
}
/** The writer token (Addendum 3); every write in these tests carries it unless a test says otherwise. */
const token = () => readFileSync(join(home, 'writer.token'), 'utf8').trim()
const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dojo-Writer': token(), ...headers }, body: JSON.stringify(body) })
const op = (id: string, doc: object = { id }) => ({ tbl: 'tickets', op: 'put', id, doc, at: 'x' })

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'dojo-srv-'))
  dist = mkdtempSync(join(tmpdir(), 'dojo-dist-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'index.html'), '<html>app</html>')
  writeFileSync(join(dist, 'assets', 'a-1.js'), 'x')
  await start()
})
afterEach(async () => {
  await s.close()
  rmSync(home, { recursive: true, force: true })
  rmSync(dist, { recursive: true, force: true })
})

describe('static + helper', () => {
  it('serves index with no-cache, SPA fallback, hashed assets, 404 for missing files, no traversal', async () => {
    const r = await fetch(base + '/')
    expect(await r.text()).toBe('<html>app</html>')
    expect(r.headers.get('cache-control')).toBe('no-cache')
    expect(await (await fetch(base + '/designs/session/x')).text()).toBe('<html>app</html>')
    expect((await fetch(base + '/assets/a-1.js')).headers.get('cache-control')).toContain('immutable')
    expect((await fetch(base + '/nope.js')).status).toBe(404)
    // raw request so the client does not normalise the dots away
    const status = await new Promise<number>(res => {
      const port = new URL(base).port
      httpRequest({ host: '127.0.0.1', port, path: '/..%2f..%2fetc/passwd', headers: { host: `127.0.0.1:${port}` } }, r => { r.resume(); res(r.statusCode ?? 0) }).end()
    })
    expect([403, 404]).toContain(status)
  })

  it('still answers the AI helper routes in fake mode', async () => {
    expect((await (await fetch(base + '/health')).json()).mode).toBe('fake')
    const r = await post('/ai/hint', { ticket: { id: 't', title: 'T', track: 'dsa' }, context: { level: 1 } })
    expect(r.status).toBe(200)
    expect((await r.json()).ok).toBe(true)
  })

  it('keeps the Host pin', async () => {
    const port = new URL(base).port
    const status = await new Promise<number>(res => {
      httpRequest({ host: '127.0.0.1', port, path: '/db/health', headers: { host: 'evil.example' } }, r => { r.resume(); res(r.statusCode ?? 0) }).end()
    })
    expect(status).toBe(403)
  })
})

describe('G6: DOJO_HOME/profile.json (the learner\'s own values, never shipped)', () => {
  const PLAN = { planVersion: 'v1', rotation: { Mon: 'AI watch' }, schedule: { restDay: 'Rest, exercise, nothing else.' }, sprints: [] }
  beforeEach(() => {
    mkdirSync(join(dist, 'data'))
    writeFileSync(join(dist, 'data', 'plan.json'), JSON.stringify(PLAN))
  })

  it('serves the shipped plan unchanged with no profile, and no project repo in /db/health', async () => {
    const r = await fetch(base + '/data/plan.json')
    expect(r.headers.get('content-type')).toContain('application/json')
    expect(r.headers.get('cache-control')).toBe('no-cache')
    expect(await r.json()).toEqual(PLAN)
    expect((await (await fetch(base + '/db/health')).json()).projectRepo).toBeNull()
  })

  it('lays the profile\'s plan.schedule and plan.learner over plan.json, read per request; other keys are ignored', async () => {
    const schedule = { block: { start: '20:00', end: '20:50' }, restDay: 'My own rest day.' }
    writeFileSync(join(home, 'profile.json'), JSON.stringify({ plan: { schedule, learner: { patternsRepo: 'https://example.com/me' }, rotation: { Mon: 'hacked' } } }))
    const got = await (await fetch(base + '/data/plan.json')).json()
    expect(got).toEqual({ ...PLAN, schedule, learner: { patternsRepo: 'https://example.com/me' } })
    writeFileSync(join(home, 'profile.json'), '{ not json')
    expect(await (await fetch(base + '/data/plan.json')).json()).toEqual(PLAN)
  })

  it('reports the profile\'s projectRepo (after ~) in /db/health; DOJO_PROJECT_REPO wins', async () => {
    writeFileSync(join(home, 'profile.json'), JSON.stringify({ projectRepo: '~/projects/capstone' }))
    await s.close()
    await start({ HOME: '/Users/learner' })
    expect((await (await fetch(base + '/db/health')).json()).projectRepo).toBe('/Users/learner/projects/capstone')
    await s.close()
    await start({ DOJO_PROJECT_REPO: '/srv/capstone' })
    expect((await (await fetch(base + '/db/health')).json()).projectRepo).toBe('/srv/capstone')
  })
})

describe('/db routes', () => {
  it('ST-01 health', async () => {
    const h = await (await fetch(base + '/db/health')).json()
    expect(h.ok).toBe(true)
    expect(h.dbPath.startsWith(home)).toBe(true)
  })

  it('health reports the data directory as `home` (Controller ruling 3, item 8) and no secrets', async () => {
    const h = await (await fetch(base + '/db/health')).json()
    expect(h.home).toBe(home)
    expect(JSON.stringify(h)).not.toContain(token())
  })

  it('health also names the user\'s home directory, so Settings can show paths as ~/… (ruling 23 K5)', async () => {
    const h = await (await fetch(base + '/db/health')).json()
    expect(h.userHome).toBe(homedir())
  })

  it('ops apply, are idempotent, and state returns them; history only grows', async () => {
    const body = { clientId: 'c', ops: [{ ...op('t1', { id: 't1', status: 'done' }), opId: 'o1' }] }
    expect((await (await post('/db/ops', body)).json()).applied).toBe(1)
    expect((await (await post('/db/ops', body)).json()).applied).toBe(0)
    const st = await (await fetch(base + '/db/state')).json()
    expect(st.tables.tickets).toEqual([{ id: 't1', status: 'done' }])
    expect((await (await fetch(base + '/db/health')).json()).ops).toBe(1)
  })

  it('/db/ops enforces the 64KB limit is lifted to 5MB, and other routes stay at 64KB', async () => {
    const big = { clientId: 'c', ops: [op('t1', { id: 't1', pad: 'x'.repeat(200_000) })] }
    expect((await post('/db/ops', big)).status).toBe(200)
    expect((await post('/db/restore', { file: 'x'.repeat(70_000) })).status).toBe(413)
    expect((await post('/db/ops', { clientId: 'c', ops: [op('t1', { pad: 'x'.repeat(5_300_000) })] })).status).toBe(413)
  })

  it('ST-09 security: evil origin 403, non-JSON 415, wrong method 405, unknown 404', async () => {
    expect((await post('/db/ops', { clientId: 'c', ops: [] }, { Origin: 'https://evil.example' })).status).toBe(403)
    const r = await fetch(base + '/db/ops', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })
    expect(r.status).toBe(415)
    expect((await fetch(base + '/db/state', { method: 'POST' })).status).toBe(405)
    expect((await fetch(base + '/db/nope')).status).toBe(404)
    expect((await post('/db/ops', { clientId: 'c', ops: [] }, { Origin: base })).status).toBe(200) // own origin
  })

  it('ST-07/08 backups list, back up now, restore with a pre-restore file', async () => {
    const list = async () => (await (await fetch(base + '/db/backups')).json()).backups as { file: string; bytes: number; at: string }[]
    const today = new Date()
    const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect((await list()).map(b => b.file)).toContain(`dojo-${ymd}.db`)
    await post('/db/ops', { clientId: 'c', ops: [op('A')] })
    const made = await (await post('/db/backup', {})).json()
    expect(made.ok).toBe(true)
    expect(made.file).toMatch(/^dojo-\d{4}-\d{2}-\d{2}-\d{6}\.db$/)
    await post('/db/ops', { clientId: 'c', ops: [op('B')] })
    const rr = await post('/db/restore', { file: made.file })
    expect(rr.status).toBe(200)
    const st = await (await fetch(base + '/db/state')).json()
    expect(st.tables.tickets.map((t: { id: string }) => t.id)).toEqual(['A'])
    expect((await list()).some(b => b.file.startsWith('pre-restore-'))).toBe(true)
    expect((await post('/db/restore', { file: '../dojo.db' })).status).toBe(400)
  })

  it('logs to DOJO_HOME/logs/server.log', () => {
    expect(readFileSync(join(home, 'logs', 'server.log'), 'utf8')).toContain('listening on 127.0.0.1')
  })
})

describe('/db CORS allow-list', () => {
  const body = { clientId: 'c', ops: [] }
  it("answers only its own origin: the helper's dev ports are not allowed on /db", async () => {
    const r = await post('/db/ops', body, { Origin: 'http://127.0.0.1:8790' })
    expect(r.status).toBe(403)
    expect(r.headers.get('access-control-allow-origin')).toBeNull()
    const own = await post('/db/ops', body, { Origin: base })
    expect(own.status).toBe(200)
    expect(own.headers.get('access-control-allow-origin')).toBe(base)
    const pre = await fetch(base + '/db/ops', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:8790', 'Access-Control-Request-Method': 'POST' } })
    expect(pre.status).toBe(403)
  })

  it('DOJO_DB_EXTRA_ORIGINS adds origins (the dev proxy)', async () => {
    await s.close()
    await start({ DOJO_DB_EXTRA_ORIGINS: 'http://127.0.0.1:8790, http://localhost:8790' })
    const r = await post('/db/ops', body, { Origin: 'http://localhost:8790' })
    expect(r.status).toBe(200)
    expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:8790')
    const pre = await fetch(base + '/db/ops', { method: 'OPTIONS', headers: { Origin: 'http://127.0.0.1:8790', 'Access-Control-Request-Method': 'POST' } })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:8790')
  })

  it('dev (no --dist) keeps the helper allow-list on the AI routes; a build does not (SEC-D-06)', async () => {
    expect((await fetch(base + '/health', { headers: { Origin: 'http://127.0.0.1:8790' } })).status).toBe(403)
    await s.close()
    s = createDojoServer(readServerConfig(['--fake'], { DOJO_HOME: home, DOJO_PORT: '0' }))
    base = `http://127.0.0.1:${await s.listen(0)}`
    expect((await fetch(base + '/health', { headers: { Origin: 'http://127.0.0.1:8790' } })).status).toBe(200)
  })
})

describe('Addendum 3/4: the writer token', () => {
  const bare = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

  it('is created on start in DOJO_HOME/writer.token, mode 0600, and survives a restart', async () => {
    const t = token()
    expect(t.length).toBeGreaterThanOrEqual(32)
    expect(statSync(join(home, 'writer.token')).mode & 0o777).toBe(0o600)
    await s.close()
    await start()
    expect(token()).toBe(t)
  })

  it.each(['/db/ops', '/db/backup', '/db/restore'])('%s without X-Dojo-Writer (or with a wrong one) is 403 not_writer', async path => {
    for (const headers of [{}, { 'X-Dojo-Writer': 'nope' }] as Record<string, string>[]) {
      const r = await bare(path, path === '/db/ops' ? { clientId: 'c', ops: [op('x')] } : path === '/db/restore' ? { file: 'dojo-2026-01-01.db' } : {}, headers)
      expect(r.status).toBe(403)
      expect(await r.json()).toEqual({ ok: false, error: expect.objectContaining({ code: 'not_writer' }) })
    }
    expect((await (await fetch(base + '/db/health')).json()).ops).toBe(0)
  })

  it('reads need no token', async () => {
    for (const p of ['/db/health', '/db/state', '/db/backups']) expect((await fetch(base + p)).status).toBe(200)
  })

  it('checks Host, Origin, Content-Type and size before the writer token (Addendum 4 Q3)', async () => {
    const port = new URL(base).port
    const hostStatus = await new Promise<number>(res => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/db/ops', method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } }, r => { r.resume(); res(r.statusCode ?? 0) })
      req.end('{}')
    })
    expect(hostStatus).toBe(403)
    const o = await bare('/db/ops', {}, { Origin: 'https://evil.example' })
    expect(o.status).toBe(403)
    expect((await o.json()).error.code).toBe('forbidden_origin')
    expect((await fetch(base + '/db/ops', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415)
    expect((await bare('/db/ops', { clientId: 'c', ops: [op('t', { pad: 'x'.repeat(5_300_000) })] })).status).toBe(413)
    expect((await bare('/db/ops', { clientId: 'c', ops: [] })).status).toBe(403)
  })

  it('preflight allows the X-Dojo-Writer header for its own origin', async () => {
    const r = await fetch(base + '/db/ops', { method: 'OPTIONS', headers: { Origin: base, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-dojo-writer' } })
    expect(r.status).toBe(204)
    expect(r.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('x-dojo-writer')
  })
})

describe('Addendum 5/6 conformance', () => {
  it('body limits: /db/ops takes up to 5 MiB; one byte more is 413; other POSTs stop at 64 KiB', async () => {
    const MiB5 = 5 * 1024 * 1024
    const opsBody = (n: number) => {
      const shell = JSON.stringify({ clientId: 'c', ops: [op('big', { id: 'big', pad: '' })] })
      return shell.replace('"pad":""', `"pad":"${'x'.repeat(n - shell.length)}"`)
    }
    const send = (path: string, body: string) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dojo-Writer': token() }, body })
    expect((await send('/db/ops', opsBody(MiB5))).status).toBe(200)
    expect((await send('/db/ops', opsBody(MiB5 + 1))).status).toBe(413)
    expect((await send('/db/backup', JSON.stringify({ pad: 'x'.repeat(64 * 1024) }))).status).toBe(413)
  })

  it('/db/kept/resolve and /db/import are gone (404)', async () => {
    expect((await post('/db/kept/resolve', { seq: 1 })).status).toBe(404)
    expect((await post('/db/import', { clientId: 'c', tables: {} })).status).toBe(404)
  })

  it('a connection to the machine\'s LAN address fails to connect (loopback only)', async () => {
    const lan = Object.values(networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)?.address
    if (!lan) return // no LAN address on this machine
    const port = Number(new URL(base).port)
    const outcome = await new Promise<string>(res => {
      const sock = connect({ host: lan, port })
      sock.once('connect', () => { sock.destroy(); res('connected') })
      sock.once('error', e => res((e as NodeJS.ErrnoException).code ?? 'error'))
      sock.setTimeout(2000, () => { sock.destroy(); res('timeout') })
    })
    expect(outcome).not.toBe('connected')
  })
})

describe('SEC-D-06: /ai/* is for the writer, and an app build answers its own origin only', () => {
  const HINT = { ticket: { id: 't', title: 'T', track: 'dsa' }, context: { level: 1 } }
  it('a job without the writer token (or with a wrong one) is 403 not_writer; with it, 200', async () => {
    for (const headers of [{ 'X-Dojo-Writer': '' }, { 'X-Dojo-Writer': 'x'.repeat(token().length) }]) {
      const r = await post('/ai/hint', HINT, headers)
      expect(r.status).toBe(403)
      expect((await r.json()).error.code).toBe('not_writer')
    }
    const none = await fetch(base + '/ai/hint', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(HINT) })
    expect(none.status).toBe(403)
    expect((await post('/ai/hint', HINT)).status).toBe(200)
  })

  it('the preflight lets the app send its token; GET /health stays open to the own origin', async () => {
    const own = base.replace('127.0.0.1', 'localhost')
    const pre = await fetch(base + '/ai/hint', { method: 'OPTIONS', headers: { Origin: base, 'Access-Control-Request-Headers': 'content-type,x-dojo-writer' } })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-headers')).toContain('X-Dojo-Writer')
    expect((await fetch(base + '/health', { headers: { Origin: own } })).status).toBe(200)
  })

  it('serving a build (--dist or --real), the dev ports are not allowed origins; DOJO_HELPER_ORIGINS still is', async () => {
    await s.close()
    await start({ DOJO_HELPER_ORIGINS: 'http://127.0.0.1:5173' })
    for (const dev of ['http://127.0.0.1:8790', 'http://localhost:8787', 'http://127.0.0.1:8798']) {
      const r = await post('/ai/hint', HINT, { Origin: dev })
      expect(r.status, dev).toBe(403)
      expect((await r.json()).error.code, dev).toBe('forbidden_origin')
      expect((await fetch(base + '/health', { headers: { Origin: dev } })).status, dev).toBe(403)
    }
    expect((await post('/ai/hint', HINT, { Origin: 'http://127.0.0.1:5173' })).status).toBe(200)
    expect((await post('/ai/hint', HINT, { Origin: base })).status).toBe(200)
    const real = readServerConfig(['--real', '--fake'], { DOJO_HOME: home, DOJO_PORT: '0' })
    expect([...real.originAllowList]).toEqual([]) // the own origin is added on listen
  })

  it('dev (no --dist: scripts/dev.mjs) keeps the dev ports', () => {
    const dev = readServerConfig(['--fake'], { DOJO_HOME: home, DOJO_PORT: '0' })
    expect(dev.originAllowList.has('http://127.0.0.1:8790')).toBe(true)
  })
})

describe('SEC-D-02: the runner\'s raw-imports switch is for its tests only', () => {
  it('--test-allow-raw-imports sets it; with --real the server refuses to start', () => {
    expect(readServerConfig(['--fake'], { DOJO_HOME: home, DOJO_PORT: '0' }).runnerAllowRawImports).toBe(false)
    expect(readServerConfig(['--fake', '--test-allow-raw-imports'], { DOJO_HOME: home, DOJO_PORT: '0' }).runnerAllowRawImports).toBe(true)
    expect(() => readServerConfig(['--real', '--test-allow-raw-imports'], { DOJO_HOME: home, DOJO_PORT: '0' })).toThrow(/never with --real/)
  })
  it('the Mac app never passes it', () => {
    expect(readFileSync('electron/main.mjs', 'utf8')).not.toContain('test-allow-raw-imports')
  })
})

describe('G4 #7: the app cannot be framed', () => {
  it.each(['/', '/designs/session/x', '/assets/a-1.js'])('%s carries frame-ancestors none and X-Frame-Options DENY', async path => {
    const r = await fetch(base + path)
    expect(r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(r.headers.get('x-frame-options')).toBe('DENY')
  })
})

describe('SEC-D-03: the app\'s Content-Security-Policy', () => {
  it.each(['/', '/designs/session/x', '/assets/a-1.js'])('%s carries the app policy, with no report-uri outside e2e runs', async path => {
    const csp = (await fetch(base + path)).headers.get('content-security-policy')
    expect(csp).toBe(appCsp())
    expect(csp).not.toContain('report-uri')
  })

  it('the plan (laid over with the profile) carries it too', async () => {
    mkdirSync(join(dist, 'data'))
    writeFileSync(join(dist, 'data', 'plan.json'), '{"sprints":[]}')
    expect((await fetch(base + '/data/plan.json')).headers.get('content-security-policy')).toBe(appCsp())
  })

  it('without DOJO_CSP_REPORT_FILE there is no report sink', async () => {
    const r = await fetch(base + '/__csp-report', { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body: '{}' })
    expect(r.status).toBe(405) // the static handler: GET only
  })

  it('with DOJO_CSP_REPORT_FILE (e2e runs) violations are appended one per line', async () => {
    await s.close()
    const file = join(home, 'csp.jsonl')
    await start({ DOJO_CSP_REPORT_FILE: file })
    expect((await fetch(base + '/')).headers.get('content-security-policy')).toBe(appCsp({ report: true }))
    const report = { 'csp-report': { 'violated-directive': 'script-src-elem', 'blocked-uri': 'inline' } }
    const r = await fetch(base + '/__csp-report', { method: 'POST', headers: { 'Content-Type': 'application/csp-report' }, body: JSON.stringify(report, null, 2) })
    expect(r.status).toBe(204)
    const lines = readFileSync(file, 'utf8').trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toEqual(report)
  })
})

describe('Addendum 8 conformance', () => {
  const raw = (path: string, headers: Record<string, string>, body = '{}', method = 'POST') => new Promise<number>(res => {
    const port = new URL(base).port
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...headers } }, r => { r.resume(); res(r.statusCode ?? 0) })
    req.end(body)
  })
  it('a wrong token of the same length, another length or empty is 403 not_writer, nothing applied', async () => {
    const t = token()
    for (const wrong of [t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'), t + 'x', '']) {
      const r = await post('/db/ops', { clientId: 'c', ops: [op('w')] }, { 'X-Dojo-Writer': wrong })
      expect(r.status).toBe(403)
      expect((await r.json()).error.code).toBe('not_writer')
    }
    expect((await (await fetch(base + '/db/health')).json()).ops).toBe(0)
  })

  it('several ops on one id add 1 each; clear {opId, tbl, op, at} tombstones all live rows, docs same, ops +1', async () => {
    const h = async () => (await (await fetch(base + '/db/health')).json()) as { ops: number; docs: number }
    await post('/db/ops', { clientId: 'c', ops: [{ ...op('x', { id: 'x', v: 1 }), opId: 'a1' }, { ...op('x', { id: 'x', v: 2 }), opId: 'a2' }, { ...op('x', { id: 'x', v: 3 }), opId: 'a3' }, { ...op('y'), opId: 'a4' }] })
    const h1 = await h()
    expect(h1).toMatchObject({ ops: 4, docs: 2 })
    const r = await post('/db/ops', { clientId: 'c', ops: [{ opId: 'c1', tbl: 'tickets', op: 'clear', at: new Date().toISOString() }] })
    expect(r.status).toBe(200)
    expect(await h()).toMatchObject({ ops: 5, docs: 2 })
    expect((await (await fetch(base + '/db/state')).json()).tables.tickets ?? []).toEqual([])
  })

  it('/db/state returns a put doc deep-equal to what was sent, with no extra fields', async () => {
    const doc = { id: 'd1', nested: { a: [1, 'two', null, { b: true }] }, n: 1.5, s: 'ü "q"', empty: {} }
    await post('/db/ops', { clientId: 'c', ops: [{ tbl: 'whatever', op: 'put', id: 'd1', doc, at: 'x', opId: 'z1' }] })
    expect((await (await fetch(base + '/db/state')).json()).tables.whatever).toEqual([doc])
  })

  it('Host: 127.0.0.1:<port> and localhost:<port> are accepted; a wrong port is 403 forbidden_host', async () => {
    const port = new URL(base).port
    expect(await raw('/db/health', { host: `127.0.0.1:${port}` }, '', 'GET')).toBe(200)
    expect(await raw('/db/health', { host: `localhost:${port}` }, '', 'GET')).toBe(200)
    expect(await raw('/db/health', { host: `127.0.0.1:${Number(port) + 1}` }, '', 'GET')).toBe(403)
  })
})

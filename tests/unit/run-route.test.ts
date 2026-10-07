// @vitest-environment node
// C-RUNNER §2: POST /tools/run-go and GET /tools/packs/<id> on dojo-server.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDojoServer, readServerConfig } from '../../server/dojo-server.mjs'
import { resolveGo } from '../../server/runner/runner.mjs'

let home: string
let dist: string
let s: ReturnType<typeof createDojoServer>
let base = ''

async function start(env: Record<string, string> = {}) {
  const cfg = readServerConfig(['--fake', '--dist', dist], { ...process.env, DOJO_HOME: home, DOJO_PORT: '0', ...env })
  s = createDojoServer(cfg)
  base = `http://127.0.0.1:${await s.listen(0)}`
}
const token = () => readFileSync(join(home, 'writer.token'), 'utf8').trim()
const runReq = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + '/tools/run-go', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dojo-Writer': token(), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })
const health = async () => (await fetch(base + '/db/health')).status
const P91_OK = 'package main\n\nfunc numDecodings(s string) int {\n\tprev2, prev1 := 1, 0\n\tif s[0] != \'0\' {\n\t\tprev1 = 1\n\t}\n\tfor i := 2; i <= len(s); i++ {\n\t\tcur := 0\n\t\tif s[i-1] != \'0\' {\n\t\t\tcur += prev1\n\t\t}\n\t\tif s[i-2] == \'1\' || (s[i-2] == \'2\' && s[i-1] <= \'6\') {\n\t\t\tcur += prev2\n\t\t}\n\t\tprev2, prev1 = prev1, cur\n\t}\n\treturn prev1\n}\n'

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'dojo-run-srv-'))
  dist = mkdtempSync(join(tmpdir(), 'dojo-run-dist-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'index.html'), '<html>app</html>')
  await start()
})
afterEach(async () => {
  await s.close()
  rmSync(home, { recursive: true, force: true })
  rmSync(dist, { recursive: true, force: true })
})

describe('GET /tools/packs/<id>', () => {
  it('serves the public part to any browser of this origin, never the reference', async () => {
    const r = await fetch(base + '/tools/packs/p91')
    expect(r.status).toBe(200)
    const text = await r.text()
    expect(text).not.toContain('dojo-ref')
    const p = JSON.parse(text)
    expect(p).toMatchObject({ id: 'p91', signature: 'func numDecodings(s string) int', examples: 2 })
    expect(p.cases.map((c: { call: string }) => c.call)).toEqual(['numDecodings("12")', 'numDecodings("226")', 'numDecodings("06")', 'numDecodings("11106")', 'numDecodings("2611055971756562")'])
    expect(p.starter).toContain('func numDecodings(s string) int')
    expect((await fetch(base + '/tools/packs/p1')).status).toBe(404)
  })

  it('no static path serves a reference', async () => {
    for (const p of ['/server/runner/packs/p91/ref.go', '/runner/packs/p91/ref.go', '/packs/p91/ref.go']) {
      expect(await (await fetch(base + p)).text()).not.toContain('dojo-ref')
    }
  })
})

describe('POST /tools/run-go: checks', () => {
  it('RN-10: 403 not_writer without (or with a wrong) token; 400 unknown_pack', async () => {
    const none = await fetch(base + '/tools/run-go', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pack: 'p91', code: P91_OK, mode: 'run' }) })
    expect(none.status).toBe(403)
    expect(await none.json()).toEqual({ error: 'not_writer' })
    const wrong = await runReq({ pack: 'p91', code: P91_OK, mode: 'run' }, { 'X-Dojo-Writer': 'nope' })
    expect(wrong.status).toBe(403)
    const unknown = await runReq({ pack: 'p1', code: P91_OK, mode: 'run' })
    expect(unknown.status).toBe(400)
    expect(await unknown.json()).toEqual({ error: 'unknown_pack' })
    const noPack = await runReq({ pack: 'p200', code: P91_OK, mode: 'run' })
    expect(noPack.status).toBe(400)
    expect(await noPack.json()).toEqual({ error: 'unknown_pack' })
  })

  it('413 for code over 64 KiB, 415 for a non-JSON type, 403 for a foreign origin, 400 for a bad mode', async () => {
    const big = await runReq({ pack: 'p91', code: 'x'.repeat(64 * 1024 + 1), mode: 'run' })
    expect(big.status).toBe(413)
    expect(await big.json()).toEqual({ error: 'too_large' })
    // exactly 64 KiB of code that JSON-escapes to far more than 64 KiB is accepted (it then fails to compile)
    expect((await runReq({ pack: 'p91', code: '"\n'.repeat(64 * 1024 / 2), mode: 'run' }, { 'X-Dojo-Writer': 'nope' })).status).toBe(403)
    const type = await fetch(base + '/tools/run-go', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'X-Dojo-Writer': token() }, body: '{}' })
    expect(type.status).toBe(415)
    const evil = await runReq({ pack: 'p91', code: P91_OK, mode: 'run' }, { Origin: 'https://evil.example' })
    expect(evil.status).toBe(403)
    expect((await runReq({ pack: 'p91', code: P91_OK, mode: 'all' })).status).toBe(400)
  })

  it('RN-17: DOJO_GO_BIN=/nonexistent/go gives no_toolchain and the server stays healthy', async () => {
    await s.close()
    await start({ DOJO_GO_BIN: '/nonexistent/go' })
    const r = await runReq({ pack: 'p91', code: P91_OK, mode: 'submit' })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ status: 'no_toolchain', cases: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }] })
    expect(await health()).toBe(200)
  })
})

const withGo = resolveGo(process.env) ? describe : describe.skip

withGo('POST /tools/run-go: runs', () => {
  it('RN-01: a correct Submit runs all five cases and passes; Run runs the two examples', async () => {
    const r = await runReq({ pack: 'p91', code: P91_OK, mode: 'submit' })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toMatchObject({ status: 'ok', errors: [], stdout: '', steps: [], truncated: false })
    expect(body.cases.map((c: { pass: boolean }) => c.pass)).toEqual([true, true, true, true, true])
    expect(typeof body.ms).toBe('number')
    const run = await (await runReq({ pack: 'p91', code: P91_OK, mode: 'run' })).json()
    expect(run.cases).toHaveLength(2)
  }, 60_000)

  it('RN-09: a second request while one runs gets 409 busy', async () => {
    const loop = 'package main\nfunc numDecodings(s string) int { n := len(s); _ = n\n\tfor {}\n}\n'
    const first = runReq({ pack: 'p91', code: loop, mode: 'run' })
    await new Promise(r => setTimeout(r, 300))
    const second = await runReq({ pack: 'p91', code: P91_OK, mode: 'run' })
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ error: 'busy' })
    expect(await health()).toBe(200)
    const done = await (await first).json()
    expect(done.status).toBe('timeout')
    // free again afterwards
    expect((await (await runReq({ pack: 'p91', code: P91_OK, mode: 'run' })).json()).status).toBe('ok')
  }, 60_000)

  it('RN-08: the server stays healthy after a 2 GiB allocation', async () => {
    const r = await (await runReq({ pack: 'p91', code: 'package main\nfunc numDecodings(s string) int { n := len(s); _ = n\n\tb := make([]byte, 2<<30)\n\tfor i := range b { b[i] = 1 }\n\treturn int(b[n])\n}\n', mode: 'run' })).json()
    expect(['memory_limit', 'runtime_error']).toContain(r.status)
    expect(await health()).toBe(200)
  }, 60_000)
})

describe('H1: request guard', () => {
  it('turns a sync or async throw anywhere in a handler into 500 server_error, and logs it', async () => {
    const { guardHandler } = await import('../../server/dojo-server.mjs')
    const http = await import('node:http')
    const logged: string[] = []
    const srv = http.createServer(guardHandler((req: { url?: string }) => {
      if (req.url === '/sync') throw new Error('boom-sync')
      return Promise.reject(new Error('boom-async'))
    }, (m: string) => logged.push(m)))
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
    const port = (srv.address() as { port: number }).port
    for (const p of ['/sync', '/async']) {
      const r = await fetch(`http://127.0.0.1:${port}${p}`)
      expect(r.status).toBe(500)
      expect(await r.json()).toEqual({ error: 'server_error' })
    }
    await new Promise(r => srv.close(r))
    expect(logged.join('\n')).toContain('boom-sync')
    expect(logged.join('\n')).toContain('boom-async')
  })

  it('installCrashGuards logs unhandled rejections and uncaught exceptions instead of exiting', async () => {
    const { installCrashGuards } = await import('../../server/dojo-server.mjs')
    const { EventEmitter } = await import('node:events')
    const proc = new EventEmitter()
    const logged: string[] = []
    installCrashGuards((m: string) => logged.push(m), proc)
    expect(proc.listenerCount('unhandledRejection')).toBe(1)
    expect(proc.listenerCount('uncaughtException')).toBe(1)
    proc.emit('unhandledRejection', new Error('lost-promise'))
    proc.emit('uncaughtException', new Error('thrown-late'))
    expect(logged.join('\n')).toContain('lost-promise')
    expect(logged.join('\n')).toContain('thrown-late')
  })
})

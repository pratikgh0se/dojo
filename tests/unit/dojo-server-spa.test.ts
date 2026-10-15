// @vitest-environment node
// A reload or direct load of a client route must get the SPA page even when its last segment has a dot
// (ticket ids do: /do/ai.l3.learn.4). A missing real asset stays a 404, and nothing escapes dist.
import { type ChildProcess, spawn } from 'node:child_process'
import { request } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SERVER = fileURLToPath(new URL('../../server/dojo-server.mjs', import.meta.url))
let child: ChildProcess
let base = ''
let root = ''
let home = ''

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'dojo-spa-'))
  home = join(root, 'home')
  const dist = join(root, 'dist')
  mkdirSync(home)
  mkdirSync(join(dist, 'assets'), { recursive: true })
  writeFileSync(join(dist, 'index.html'), '<html>app</html>')
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)')
  writeFileSync(join(root, 'secret.txt'), 'SECRET')
  symlinkSync(join(root, 'secret.txt'), join(dist, 'link.txt'))
  child = spawn(process.execPath, [SERVER, '--fake', '--dist', dist], { env: { ...process.env, DOJO_HOME: home, DOJO_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout!.on('data', c => { out += c })
  child.stderr!.on('data', c => { out += c })
  base = await new Promise<string>((ok, err) => {
    const t = setTimeout(() => err(new Error(`server did not start: ${out}`)), 15_000)
    const check = () => { const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(out); if (m) { clearTimeout(t); ok(`http://127.0.0.1:${m[1]}`) } else setTimeout(check, 50) }
    check()
  })
})
afterAll(async () => {
  child.kill('SIGTERM')
  await new Promise(r => { child.once('exit', r); setTimeout(r, 3000) })
  rmSync(root, { recursive: true, force: true })
})

const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers })
/** A raw request: fetch() would normalise `/../` away before it left the client. */
function raw(path: string): Promise<{ status: number; body: string }> {
  return new Promise((ok, err) => {
    const req = request(`${base}/`, { path, method: 'GET' }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => ok({ status: res.statusCode ?? 0, body }))
    })
    req.on('error', err)
    req.end()
  })
}

describe('SPA fallback for dotted client routes', () => {
  it('serves index.html (200 text/html) for /do/<dotted ticket id>', async () => {
    for (const p of ['/do/ai.l3.learn.4', '/do/ai.l3.learn.4?x=1', '/skills/ai.l3', '/do/a.json']) {
      const res = await get(p, { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' })
      expect(res.status, p).toBe(200)
      expect(res.headers.get('content-type'), p).toMatch(/^text\/html/)
      expect(await res.text(), p).toBe('<html>app</html>')
    }
    expect((await get('/do/ai.l3.learn.4')).status).toBe(200)
  })

  it('still answers 404 for a missing real asset', async () => {
    for (const p of ['/assets/missing.js', '/assets/missing', '/missing.css', '/favicon.png', '/db/nope', '/tools/nope', '/data/nope.json']) {
      const res = await get(p)
      expect(res.status, p).toBe(404)
      expect(res.headers.get('content-type') ?? '', p).not.toMatch(/html/)
    }
  })

  it('serves the app for a bare /ai (SHELL-20) and /db, and keeps /ai/<job> as the server JSON', async () => {
    for (const p of ['/ai', '/db']) {
      const res = await get(p, { Accept: 'text/html' })
      expect(res.status, p).toBe(200)
      expect(res.headers.get('content-type'), p).toMatch(/^text\/html/)
      expect(await res.text(), p).toBe('<html>app</html>')
    }
    const job = await fetch(`${base}/ai/hint`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    expect(job.status).toBe(403)
    expect(job.headers.get('content-type')).toMatch(/json/)
    expect((await job.json()).error.code).toBe('not_writer')
  })

  it('serves a real asset with its type', async () => {
    const res = await get('/assets/app.js')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(await res.text()).toBe('console.log(1)')
  })

  it('refuses traversal out of dist', async () => {
    for (const p of ['/../secret.txt', '/..%2fsecret.txt', '/%2e%2e/secret.txt', '/assets/../../secret.txt', '/assets/..%2f..%2fsecret.txt', '/link.txt']) {
      const res = await raw(p)
      expect(res.body, p).not.toContain('SECRET')
    }
    // an encoded slash survives URL parsing, so the dist-root check is what refuses it
    expect((await raw('/..%2fsecret.txt')).status).toBe(403)
    expect((await raw('/assets/..%2f..%2fsecret.txt')).status).toBe(403)
    // a symlink inside dist that points outside is refused by its real path
    expect((await raw('/link.txt')).status).toBe(403)
  })
})

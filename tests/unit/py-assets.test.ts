// @vitest-environment node
// C-PYTHON §3: dojo-server serves the Python runner's assets to an opaque origin, and nothing else.
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { frameCsp, isPyAsset, pyAssetHeaders } from '../../server/runner/pyframe.mjs'
import { appCsp } from '../../server/csp.mjs'

const SERVER = fileURLToPath(new URL('../../server/dojo-server.mjs', import.meta.url))
let child: ChildProcess
let base = ''
let home = ''
let dist = ''

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'dojo-pyassets-home-'))
  dist = mkdtempSync(join(tmpdir(), 'dojo-pyassets-dist-'))
  for (const d of ['assets', 'pyodide', 'pyrunner']) mkdirSync(join(dist, d))
  writeFileSync(join(dist, 'index.html'), '<html>app</html>')
  writeFileSync(join(dist, 'assets', 'x.js'), 'x')
  writeFileSync(join(dist, 'pyodide', 'pyodide.asm.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]))
  writeFileSync(join(dist, 'pyodide', 'python_stdlib.zip'), 'zip')
  writeFileSync(join(dist, 'pyodide', 'pyodide.js'), '//js')
  writeFileSync(join(dist, 'pyrunner', 'frame.html'), '<html>frame</html>')
  writeFileSync(join(dist, 'pyrunner', 'dojo_tk.py'), '# py')
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
  rmSync(home, { recursive: true, force: true })
  rmSync(dist, { recursive: true, force: true })
})

const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers })

describe('the pure parts', () => {
  it('names exactly the two asset prefixes', () => {
    expect(isPyAsset('/pyodide/pyodide.js')).toBe(true)
    expect(isPyAsset('/pyrunner/frame.html')).toBe(true)
    expect(isPyAsset('/pyodide/')).toBe(false)
    for (const p of ['/', '/db/state', '/tools/packs/p91', '/assets/x.js', '/pyodideX/a', '/x/pyodide/a']) expect(isPyAsset(p), p).toBe(false)
  })
  it('the frame CSP allows only the asset prefixes and this origin as an ancestor', () => {
    const csp = frameCsp('http://127.0.0.1:8985')
    expect(csp).toContain("default-src 'none'")
    expect(csp).not.toMatch(/(?<!wasm-)unsafe-eval/)
    expect(csp).toContain("'wasm-unsafe-eval'")
    expect(csp).toContain('connect-src http://127.0.0.1:8985/pyodide/ http://127.0.0.1:8985/pyrunner/')
    expect(csp).toContain('frame-ancestors http://127.0.0.1:8985')
    expect(csp).not.toMatch(/connect-src[^;]*(\*|'self'|\/db|\/tools)/)
    expect(pyAssetHeaders('/pyrunner/dojo_tk.py', 'http://x')['Content-Security-Policy']).toBeUndefined()
  })
})

describe('serving the assets to an opaque origin', () => {
  it('serves /pyodide/* with CORS *, the wasm type and no framing ban lifted', async () => {
    const res = await get('/pyodide/pyodide.asm.wasm', { Origin: 'null' })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('content-type')).toBe('application/wasm')
    expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    expect((await get('/pyodide/python_stdlib.zip')).headers.get('content-type')).toBe('application/zip')
    expect(res.headers.get('vary') ?? '').not.toMatch(/origin/i)
  })

  it('serves the frame page with its CSP, framable by this origin only', async () => {
    const res = await get('/pyrunner/frame.html', { Origin: 'null' })
    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('content-security-policy')).toBe(frameCsp(base))
    expect(res.headers.get('x-frame-options')).toBeNull()
    expect(res.headers.get('content-type')).toMatch(/^text\/html/)
    const py = await get('/pyrunner/dojo_tk.py')
    expect(py.status).toBe(200)
    expect(py.headers.get('content-type')).toMatch(/^text\/plain/)
    // SEC-D-03: the app's policy is never sent with the runner's files (two policies would both apply)
    expect(py.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
  })

  it('answers a missing asset 404, and a write 405', async () => {
    expect((await get('/pyodide/nope.js', { Origin: 'null' })).status).toBe(404)
    expect((await fetch(`${base}/pyodide/pyodide.js`, { method: 'POST', body: 'x' })).status).toBe(405)
  })

  it('still refuses Origin: null everywhere else, and never loosens /db or /tools', async () => {
    for (const p of ['/db/state', '/db/health', '/tools/packs/p91', '/', '/assets/x.js']) {
      const res = await get(p, { Origin: 'null' })
      expect(res.status, p).toBe(403)
      expect(res.headers.get('access-control-allow-origin'), p).not.toBe('*')
    }
    const w = await fetch(`${base}/pyodide/pyodide.js`, { method: 'POST', headers: { Origin: 'null', 'Content-Type': 'application/json' }, body: '{}' })
    expect(w.status).toBe(403) // a write from an opaque origin is refused before anything else
    // a foreign origin is not welcome on the assets either
    expect((await get('/pyodide/pyodide.js', { Origin: 'https://evil.example' })).status).toBe(403)
    // the same-origin app's own reads of /db are unchanged
    expect((await get('/db/health')).status).toBe(200)
  })

  it('other static files keep the no-framing headers and get no CORS', async () => {
    const res = await get('/assets/x.js')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
    expect(res.headers.get('content-security-policy')).toBe(appCsp()) // SEC-D-03 (frame-ancestors 'none' is in it)
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
    const idx = await get('/')
    expect(idx.headers.get('x-frame-options')).toBe('DENY')
  })

  it('a Host that is not this server is refused on the assets too', async () => {
    const res = await new Promise<number>((ok, err) => {
      import('node:http').then(({ default: http }) => {
        const u = new URL(base)
        http.get({ host: u.hostname, port: u.port, path: '/pyodide/pyodide.js', headers: { Host: 'evil.example' } }, r => { r.resume(); ok(r.statusCode ?? 0) }).on('error', err)
      })
    })
    expect(res).toBe(403)
  })
})

// Security review L1/L3: the Origin: null exemption and the CORS headers apply only to a real file under
// dist/pyodide or dist/pyrunner, never to a path that decodes out of them.
describe('path traversal under the exemption (L1)', () => {
  const raw = (path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }>((ok, err) => {
    import('node:http').then(({ default: http }) => {
      const u = new URL(base)
      http.get({ host: u.hostname, port: u.port, path, headers }, r => {
        let body = ''
        r.on('data', c => { body += c })
        r.on('end', () => ok({ status: r.statusCode ?? 0, headers: r.headers, body }))
      }).on('error', err)
    })
  })

  it('refuses encoded slashes, dot segments and backslashes in the asset prefixes, with or without Origin: null', async () => {
    for (const p of [
      '/pyodide/..%2fassets%2fx.js', '/pyodide/..%2Fassets%2Fx.js', '/pyodide/%2e%2e/assets/x.js', '/pyodide/%2e%2e%2fassets%2fx.js',
      '/pyrunner/..%5cassets%5cx.js', '/pyodide/%2fassets%2fx.js', '/pyodide/a%00b', '/pyrunner/%252e%252e/x', '/pyodide//assets/x.js',
    ]) {
      for (const headers of [{ Origin: 'null' }, {}] as Record<string, string>[]) {
        const r = await raw(p, headers)
        // a plain %2e%2e dot segment is normalised by the URL parser to the ordinary /assets file: served as any
        // static file, but never with the runner's CORS * (asserted below)
        const normalised = p.includes('%2e%2e/')
        if (!normalised) expect(r.status, `${p} ${JSON.stringify(headers)}`).not.toBe(200)
        if (!normalised || 'Origin' in headers) expect(r.body, p).not.toBe('x')
        expect(r.headers['access-control-allow-origin'], p).toBeUndefined()
      }
    }
  })

  it('a real asset still works, and the dist file outside the prefixes is never served with CORS *', async () => {
    const ok = await raw('/pyodide/pyodide.js', { Origin: 'null' })
    expect(ok.status).toBe(200)
    expect(ok.headers['access-control-allow-origin']).toBe('*')
    const out = await raw('/assets/x.js')
    expect(out.status).toBe(200)
    expect(out.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('the exemption is only for a path inside the prefixes: /assets, /db and /tools still 403 with Origin: null', async () => {
    for (const p of ['/assets/x.js', '/db/state', '/pyodidex/a', '/pyodide', '/pyodide/../assets/x.js']) {
      const r = await raw(p, { Origin: 'null' })
      expect([403, 404], p).toContain(r.status)
      expect(r.body, p).not.toBe('x')
    }
  })
})

describe('nosniff (L3)', () => {
  it('is on the runner assets and on the other static files', async () => {
    for (const p of ['/pyodide/pyodide.js', '/pyrunner/frame.html', '/pyrunner/dojo_tk.py', '/assets/x.js', '/']) {
      expect((await get(p)).headers.get('x-content-type-options'), p).toBe('nosniff')
    }
  })
})

describe('a missing runner asset is a 404, never the SPA page', () => {
  it('404 with nosniff for a missing file with or without an extension', async () => {
    for (const p of ['/pyodide/nope', '/pyodide/nope.js', '/pyrunner/nope', '/pyrunner/sub/dir', '/pyodide/pyodide.js/x']) {
      const res = await get(p)
      expect(res.status, p).toBe(404)
      expect(res.headers.get('x-content-type-options'), p).toBe('nosniff')
      expect(await res.text(), p).not.toContain('<html>app')
    }
    expect((await get('/some/spa/route')).status).toBe(200) // the app's own routes still fall back
  })
})

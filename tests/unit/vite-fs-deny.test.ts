// @vitest-environment node
// I3: the Vite dev server must not serve the packs' reference solutions (or other secrets) from the
// app root. Starts a real dev server from vite.config.ts on a free port and probes it.
import { createServer as netServer } from 'node:net'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'

const APP = resolve(__dirname, '..', '..')
const freePort = () => new Promise<number>((ok, err) => {
  const s = netServer()
  s.once('error', err)
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)) })
})

describe('Vite dev server file serving (I3)', () => {
  let vite: ViteDevServer
  let base = ''
  beforeAll(async () => {
    const port = await freePort()
    // No dependency pre-bundling: the test only probes file serving, and the optimizer is slow to stop.
    vite = await createServer({ configFile: join(APP, 'vite.config.ts'), root: APP, logLevel: 'silent', server: { port, strictPort: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } })
    await vite.listen()
    base = `http://127.0.0.1:${port}`
  }, 30_000)
  afterAll(async () => { await Promise.race([vite?.close(), new Promise(r => setTimeout(r, 20_000))]) }, 30_000)

  it('the app itself is still served', async () => {
    const r = await fetch(base + '/')
    expect(r.status).toBe(200)
    expect(await r.text()).toContain('<div id="root">')
    const main = await fetch(base + '/src/runner/status.ts')
    expect(main.status).toBe(200)
    await main.text()
  })

  it('serves the Do chunk\'s modules and every module they import (the shared step shape is not under server/)', async () => {
    for (const mod of ['/src/runner/dpModel.ts', '/src/runner/steps.ts', '/src/runner/types.ts', '/src/runner/families/model.ts', '/src/screens/Do.tsx']) {
      const r = await fetch(base + mod)
      expect(r.status, mod).toBe(200)
      const code = await r.text()
      for (const m of code.matchAll(/from ["'](\/[^"']+)["']/g)) {
        if (m[1].startsWith('/node_modules/') || m[1].startsWith('/@')) continue
        const dep = await fetch(base + m[1])
        expect(dep.status, `${mod} imports ${m[1]}`).toBe(200)
        await dep.text()
      }
    }
  }, 60_000)

  it('never serves a pack\'s ref.go, by any path or query', async () => {
    expect(readFileSync(join(APP, 'server', 'runner', 'packs', 'p91', 'ref.go'), 'utf8')).toContain('dojo-ref')
    const paths = [
      '/server/runner/packs/p91/ref.go', '/server/runner/packs/p91/ref.go?raw', '/server/runner/packs/p91/ref.go?import',
      '/server/runner/packs/p91/ref.go?url', '/server/runner/packs/p91/./ref.go', '/server/runner/packs/p91/REF.GO',
      `/@fs${APP}/server/runner/packs/p91/ref.go`, `/@fs${APP}/server/runner/packs/p91/ref.go?raw`,
    ]
    for (const p of paths) {
      const r = await fetch(base + p)
      const text = await r.text()
      expect(text, p).not.toContain('dojo-ref')
    }
  })

  it('denies .git, .env and key files', async () => {
    // A path with no file may fall back to index.html (200); what matters is that no file content leaks.
    for (const p of ['/.git/HEAD', `/@fs${resolve(APP, '..')}/.git`, `/@fs${resolve(APP, '..')}/.git/HEAD`, '/.env', '/.env.local', '/server.pem', '/id_rsa.key']) {
      const r = await fetch(base + p)
      const text = await r.text()
      expect(text, p).not.toMatch(/^ref: |^gitdir: |PRIVATE KEY/m)
      if (r.status === 200) expect(text, p).toContain('<div id="root">')
    }
  })

  it('M-B: any request path starting with // is refused', async () => {
    for (const p of ['//server/runner/runner.mjs', '//src/runner/status.ts', '//']) {
      const r = await fetch(base + p)
      expect(r.status, p).toBe(403)
      await r.text()
    }
  })

  it('denies the runner dir and the server\'s other sources', async () => {
    for (const p of ['/server/runner/runner.mjs', '/server/runner/tk/internal/wire/wire.go', '/server/runner/packs/p91/pack.json', '/Server/runner/runner.mjs', '/x/../server/dojo-server.mjs', '/%73erver/runner/runner.mjs', `/@fs${APP}/server/runner/runner.mjs`,
      // security round 2 M-B: new URL() read "//server" as a host
      '//server/runner/runner.mjs', '//server/dojo-server.mjs', '//server/runner/tk/tk.go?raw', '///server/runner/runner.mjs', '//x/../server/dojo-server.mjs']) {
      const r = await fetch(base + p)
      expect(r.status, p).toBe(403)
      await r.text()
    }
  })
})

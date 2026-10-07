// @vitest-environment node
// Security round 2 L2: cleaning the shared build cache (up to 1 GiB) and removing a run's temp dir
// must not block the event loop, so /db stays responsive while they run.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDojoServer, readServerConfig } from '../../server/dojo-server.mjs'
import { LIMITS, removeTree, trimCache } from '../../server/runner/runner.mjs'

/** A synthetic Go build cache: many small files in 256 two-hex-digit dirs, as GOCACHE lays them out. */
function syntheticCache(dir: string, files: number) {
  for (let d = 0; d < 256; d++) mkdirSync(join(dir, d.toString(16).padStart(2, '0')), { recursive: true })
  const b = Buffer.alloc(64, 1)
  for (let i = 0; i < files; i++) writeFileSync(join(dir, (i % 256).toString(16).padStart(2, '0'), `${i}-d`), b)
}

describe('build cache maintenance off the event loop (L2)', () => {
  let home = ''
  let base = ''
  let s: ReturnType<typeof createDojoServer>
  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'dojo-l2-home-'))
    const cfg = readServerConfig(['--fake'], { DOJO_HOME: home, DOJO_PORT: '0' })
    s = createDojoServer(cfg)
    base = `http://127.0.0.1:${await s.listen(0)}`
  }, 30_000)
  afterAll(async () => {
    await new Promise(r => s.server.close(r))
    rmSync(home, { recursive: true, force: true })
  })

  const timedHealth = async () => {
    const t0 = performance.now()
    const r = await fetch(base + '/db/health')
    await r.text()
    return { status: r.status, ms: performance.now() - t0 }
  }

  it('/db/health answers within 200 ms throughout a large trim', async () => {
    const cache = join(home, 'synthetic-gocache')
    syntheticCache(cache, 40_000)
    await timedHealth() // warm the connection
    const t0 = performance.now()
    const trim = trimCache(cache, { ...LIMITS, cacheBytes: 1024 * 1024, cacheCheckMs: 0 }, () => {})
    const first = await timedHealth()
    expect(first.status).toBe(200)
    expect(performance.now() - t0, 'the trim blocked the event loop before /db/health could answer').toBeLessThan(200)
    let done = false
    void Promise.resolve(trim).then(() => { done = true })
    const lat: number[] = [first.ms]
    while (!done) {
      const h = await timedHealth()
      expect(h.status).toBe(200)
      lat.push(h.ms)
      await new Promise(r => setTimeout(r, 20))
    }
    expect(await trim).toBe(true)
    expect(existsSync(cache)).toBe(false)
    expect(lat.length).toBeGreaterThan(2)
    expect(Math.max(...lat)).toBeLessThan(200)
  }, 120_000)

  it('removeTree is asynchronous too: /db/health answers within 200 ms while a big temp dir goes', async () => {
    const dir = join(home, 'synthetic-tmp')
    syntheticCache(dir, 20_000)
    const t0 = performance.now()
    const rm = removeTree(dir, () => {})
    const h = await timedHealth()
    expect(h.status).toBe(200)
    expect(performance.now() - t0).toBeLessThan(200)
    expect(await rm).toBe(true)
    expect(existsSync(dir)).toBe(false)
  }, 120_000)
})

describe('final review L2: shutdown and the startup sweep', () => {
  it('sweepStaleRunDirs removes only dojo-run-* directories older than the cutoff', async () => {
    const { sweepStaleRunDirs } = await import('../../server/runner/runner.mjs')
    const { utimesSync } = await import('node:fs')
    const root = mkdtempSync(join(tmpdir(), 'dojo-sweep-'))
    try {
      const mk = (name: string, ageMs: number, dir = true) => {
        const p = join(root, name)
        if (dir) { mkdirSync(join(p, 'sub'), { recursive: true }); writeFileSync(join(p, 'sub', 'f'), 'x') } else writeFileSync(p, 'x')
        const t = new Date(Date.now() - ageMs)
        utimesSync(p, t, t)
        return p
      }
      const old = mk('dojo-run-old', 11 * 60_000)
      const fresh = mk('dojo-run-fresh', 60_000)
      const other = mk('other-old', 60 * 60_000)
      const oldFile = mk('dojo-run-file', 60 * 60_000, false)
      const noDash = mk('dojo-runner-old', 60 * 60_000)
      const n = await sweepStaleRunDirs(root, 10 * 60_000)
      expect(n).toBe(1)
      expect(existsSync(old)).toBe(false)
      for (const p of [fresh, other, oldFile, noDash]) expect(existsSync(p), p).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('stopping the server waits for an in-flight run and its temp-dir removal', async () => {
    const { gracefulStop } = await import('../../server/dojo-server.mjs')
    const events: string[] = []
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const fake = {
      close: async () => { events.push('closed') },
      runner: { settled: () => gate.then(() => { events.push('removed') }) },
    }
    let done = false
    const p = gracefulStop(fake, 5000).then(() => { done = true })
    await new Promise(r => setTimeout(r, 100))
    expect(done).toBe(false)
    release()
    await p
    expect(events).toEqual(['closed', 'removed'])
  })

  it('stopping gives up after the timeout when removal hangs', async () => {
    const { gracefulStop } = await import('../../server/dojo-server.mjs')
    const t0 = Date.now()
    await gracefulStop({ close: async () => {}, runner: { settled: () => new Promise(() => {}) } }, 200)
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})

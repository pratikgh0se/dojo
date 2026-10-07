// @vitest-environment node
// Security round 2 L3: the compile phase gets an RSS watchdog over its whole process group. Tested with
// a synthetic process group (a shell whose child allocates gradually, staying under 600 MiB), never
// with a real compiler memory bomb.
import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { groupRssBytes, LIMITS, watchGroupRss } from '../../server/runner/runner.mjs'

const MiB = 1024 * 1024

/** A detached group: /bin/sh, whose node child allocates (and touches) 16 MiB every 50 ms up to `upTo` MiB, then idles. */
function allocator(upTo: number) {
  const js = `const keep = []; let n = 0; const t = setInterval(() => { if (n >= ${upTo}) return; keep.push(Buffer.alloc(16 << 20, 1)); n += 16 }, 50); setTimeout(() => clearInterval(t), 30000)`
  return spawn('/bin/sh', ['-c', `"$0" -e "$1"; :`, process.execPath, js], { detached: true, stdio: 'ignore' })
}

const waitExit = (c: ReturnType<typeof spawn>) => new Promise<{ code: number | null; signal: string | null }>(r => {
  if (c.exitCode !== null || c.signalCode !== null) return r({ code: c.exitCode, signal: c.signalCode })
  c.once('close', (code, signal) => r({ code, signal }))
})

describe('build RSS watchdog (L3)', () => {
  it('the build cap leaves room over a measured normal build (cold cache ~255 MiB peak)', () => {
    expect(LIMITS.buildRssBytes).toBeGreaterThanOrEqual(768 * MiB)
    expect(LIMITS.buildRssBytes).toBeLessThanOrEqual(1536 * MiB)
  })

  it('sums the RSS of every process in the group', async () => {
    const c = allocator(96)
    try {
      await new Promise(r => setTimeout(r, 1200))
      const rss = await groupRssBytes(c.pid!)
      expect(rss).toBeGreaterThan(96 * MiB)
      expect(rss).toBeLessThan(600 * MiB)
    } finally {
      try { process.kill(-c.pid!, 'SIGKILL') } catch { /* gone */ }
    }
  }, 20_000)

  it('kills the whole group once it passes the cap, and reports it once', async () => {
    const c = allocator(400)
    let over = 0
    let peak = 0
    const stop = watchGroupRss({ pid: c.pid!, capBytes: 200 * MiB, pollMs: 50, onOver: () => { over++ }, onSample: b => { peak = Math.max(peak, b) } })
    try {
      const exit = await Promise.race([waitExit(c), new Promise<null>(r => setTimeout(() => r(null), 15_000))])
      expect(exit, 'the group was not killed').not.toBeNull()
      expect(exit!.signal).toBe('SIGKILL')
      expect(over).toBe(1)
      expect(peak).toBeGreaterThan(200 * MiB)
      expect(peak).toBeLessThan(600 * MiB)
    } finally {
      stop()
      try { process.kill(-c.pid!, 'SIGKILL') } catch { /* gone */ }
    }
  }, 20_000)

  it('leaves a group under the cap alone', async () => {
    const c = allocator(64)
    let over = 0
    const stop = watchGroupRss({ pid: c.pid!, capBytes: 400 * MiB, pollMs: 50, onOver: () => { over++ } })
    try {
      await new Promise(r => setTimeout(r, 1500))
      expect(over).toBe(0)
      expect(c.exitCode).toBeNull()
      expect(c.signalCode).toBeNull()
    } finally {
      stop()
      try { process.kill(-c.pid!, 'SIGKILL') } catch { /* gone */ }
    }
  }, 20_000)
})

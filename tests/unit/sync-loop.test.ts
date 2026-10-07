import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb, type DojoDB, type OutboxRow } from '../../src/data/db'
import { BATCH_SIZE, createSyncLoop, KEEPALIVE_LIMIT_BYTES } from '../../src/data/sync/loop'
import { getRejectedCount, NOT_WRITER_MESSAGE, setRejectedCount, type SaveState } from '../../src/data/sync/status'

let d: DojoDB
let n = 0
let states: SaveState[]
const row = (i: number): OutboxRow => ({ opId: `op-${i}`, tbl: 'tickets', op: 'put', id: `t${i}`, doc: { id: `t${i}` }, at: 'x' })
const seed = (count: number) => d._outbox.bulkAdd(Array.from({ length: count }, (_, i) => row(i)))
const json = (status: number, body: unknown = { ok: status < 400 }) => new Response(JSON.stringify(body), { status })

function loop(fetchImpl: typeof fetch, extra = {}) {
  return createSyncLoop({ db: d, clientId: 'c1', fetchImpl, debounceMs: 5, backoffMs: [10], pollMs: 60_000, setState: s => states.push(s), adoptedDb: 'db1', ...extra })
}

beforeEach(() => {
  d = createDb(`sync-loop-${n++}`)
  states = []
})

describe('sync loop', () => {
  it('sends in batches of up to 500 and deletes rows only after a 200', async () => {
    await seed(BATCH_SIZE + 20)
    const sizes: number[] = []
    const l = loop(async (_u, init) => {
      sizes.push(JSON.parse(String(init?.body)).ops.length)
      expect(await d._outbox.count()).toBeGreaterThan(0) // still queued while the request is in flight
      return json(200)
    })
    expect(await l.flush()).toBe(true)
    expect(sizes).toEqual([500, 20])
    expect(await d._outbox.count()).toBe(0)
    expect(states.at(-1)).toBe('saved')
  })

  it('keeps rows and goes offline when the server is unreachable or 5xx, then recovers with backoff', async () => {
    await seed(3)
    let mode: 'throw' | '500' | 'ok' = 'throw'
    const l = loop(async () => {
      if (mode === 'throw') throw new TypeError('fetch failed')
      return mode === '500' ? json(500) : json(200)
    })
    expect(await l.flush()).toBe(false)
    expect(states.at(-1)).toBe('offline')
    expect(await d._outbox.count()).toBe(3)
    mode = '500'
    await new Promise(r => setTimeout(r, 30))
    expect(await d._outbox.count()).toBe(3)
    mode = 'ok'
    await vi.waitFor(async () => expect(await d._outbox.count()).toBe(0))
    expect(states.at(-1)).toBe('saved')
    l.stop()
  })

  it('resends the same opIds after a lost response (server dedupes)', async () => {
    await seed(2)
    const seen: string[][] = []
    let fail = true
    const l = loop(async (_u, init) => {
      seen.push(JSON.parse(String(init?.body)).ops.map((o: { opId: string }) => o.opId))
      if (fail) { fail = false; throw new Error('lost') }
      return json(200)
    })
    await l.flush()
    await vi.waitFor(async () => expect(await d._outbox.count()).toBe(0))
    expect(seen[0]).toEqual(seen[1])
    l.stop()
  })

  it('debounces writes and reports saving then saved', async () => {
    const calls: number[] = []
    const l = loop(async (_u, init) => { calls.push(JSON.parse(String(init?.body)).ops.length); return json(200) })
    await d._outbox.bulkAdd([row(1), row(2)])
    l.queued([row(1)])
    l.queued([row(2)])
    expect(states).toContain('saving')
    await vi.waitFor(() => expect(calls).toEqual([2]))
    await vi.waitFor(() => expect(states.at(-1)).toBe('saved'))
  })

  it('parks a permanently rejected op and keeps flushing the rest', async () => {
    await seed(3)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const l = loop(async (_u, init) => {
      const ops = JSON.parse(String(init?.body)).ops as { opId: string }[]
      return ops.some(o => o.opId === 'op-1') ? json(400) : json(200)
    })
    expect(await l.flush()).toBe(true)
    expect(await d._outbox.count()).toBe(0)
    expect(((await d._meta.get('rejectedOps'))?.value as OutboxRow[]).map(r => r.opId)).toEqual(['op-1'])
    spy.mockRestore()
  })

  it('I3: a 409 conflict parks only the colliding op', async () => {
    await seed(3)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const l = loop(async (_u, init) => {
      const ops = JSON.parse(String(init?.body)).ops as { opId: string }[]
      return ops.some(o => o.opId === 'op-2') ? json(409, { ok: false, error: { code: 'conflict', message: 'x' } }) : json(200)
    })
    expect(await l.flush()).toBe(true)
    expect(((await d._meta.get('rejectedOps'))?.value as OutboxRow[]).map(r => r.opId)).toEqual(['op-2'])
    spy.mockRestore()
  })

  it('page-hide sends committed rows with keepalive, skipping in-flight ones', async () => {
    const bodies: { keepalive?: boolean; ops: unknown[] }[] = []
    const l = loop(async (_u, init) => { if (init?.keepalive) bodies.push({ keepalive: init?.keepalive, ops: JSON.parse(String(init?.body)).ops }); return json(200) })
    await l.flush() // the outbox is empty: memory now mirrors it (I-a)
    l.queued([row(1), row(2)])
    l.flushOnHide()
    expect(bodies).toHaveLength(1)
    expect(bodies[0].keepalive).toBe(true)
    expect(bodies[0].ops).toHaveLength(2)
    l.stop()
  })
})

describe('sync loop acknowledgement', () => {
  it.each([404, 403, 405, 415])('a %i is "server unavailable", never a rejected op', async status => {
    await d._outbox.add(row(1))
    const l = createSyncLoop({ db: d, clientId: 'c', fetchImpl: async () => json(status), backoffMs: [10_000], pollMs: 60_000, setState: () => {}, adoptedDb: 'db1' })
    expect(await l.flush()).toBe(false)
    expect(await d._outbox.count()).toBe(1)
    expect(await d._meta.get('rejectedOps')).toBeUndefined()
    l.stop()
  })

  it('a 200 that is not the server JSON (SPA fallback page) keeps the rows', async () => {
    await d._outbox.add(row(1))
    const l = createSyncLoop({ db: d, clientId: 'c', fetchImpl: async () => new Response('<html>app</html>', { status: 200 }), backoffMs: [10_000], pollMs: 60_000, setState: () => {}, adoptedDb: 'db1' })
    expect(await l.flush()).toBe(false)
    expect(await d._outbox.count()).toBe(1)
    l.stop()
  })
})

describe('I2: rejected ops are visible, retryable and capped', () => {
  it('a parked op shows in the rejected count; Retry puts it back in the outbox and sends it', async () => {
    setRejectedCount(0)
    await seed(2)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let refuse = true
    const l = loop(async (_u, init) => {
      const ops = JSON.parse(String(init?.body)).ops as { opId: string }[]
      return refuse && ops.some(o => o.opId === 'op-1') ? json(422) : json(200)
    })
    expect(await l.flush()).toBe(true)
    expect(getRejectedCount()).toBe(1)
    const parked = (await d._meta.get('rejectedOps'))?.value as (OutboxRow & { error?: string })[]
    expect(parked[0]).toMatchObject({ opId: 'op-1', error: expect.stringContaining('422') })
    refuse = false
    expect(await l.retryRejected()).toBe(true)
    expect(getRejectedCount()).toBe(0)
    expect(await d._meta.get('rejectedOps')).toBeUndefined()
    expect(await d._outbox.count()).toBe(0)
    spy.mockRestore()
  })

  it('stops parking at the cap and keeps the rest queued (never drops an op)', async () => {
    await seed(4)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const reasons: string[] = []
    const l = loop(async () => json(400), { rejectedCap: 2, setState: (st: SaveState, why?: string) => { states.push(st); if (why) reasons.push(why) } })
    expect(await l.flush()).toBe(false)
    expect(((await d._meta.get('rejectedOps'))?.value as OutboxRow[])).toHaveLength(2)
    expect(await d._outbox.count()).toBe(2)
    expect(states.at(-1)).toBe('offline')
    expect(reasons.at(-1)).toMatch(/refused/i)
    l.stop()
    spy.mockRestore()
  })

  it('loads the parked count when it starts', async () => {
    setRejectedCount(0)
    await d._meta.put({ key: 'rejectedOps', value: [row(1), row(2), row(3)] })
    const l = loop(async () => json(200))
    l.start()
    await vi.waitFor(() => expect(getRejectedCount()).toBe(3))
    l.stop()
  })
})

describe('I10: posts time out', () => {
  const hang: typeof fetch = async (_u, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
  })
  it('a hanging /db/ops gives up after postTimeoutMs and reports "Not saved to disk"', async () => {
    await seed(1)
    const l = loop(hang, { postTimeoutMs: 30, backoffMs: [60_000] })
    const t0 = Date.now()
    expect(await l.flush()).toBe(false)
    expect(Date.now() - t0).toBeLessThan(2000)
    expect(states.at(-1)).toBe('offline')
    expect(await d._outbox.count()).toBe(1)
    l.stop()
  })
})

describe('page-hide keepalive', () => {
  it('I2: re-sends every unacknowledged row, including a batch still in flight (unload kills that request)', async () => {
    await seed(1)
    const bodies: { kind: string; ops: string[] }[] = []
    let release: (r: Response) => void = () => {}
    const l = loop(async (_u, init) => {
      const ops = (JSON.parse(String(init?.body)).ops as { opId: string }[]).map(o => o.opId)
      bodies.push({ kind: init?.keepalive ? 'keepalive' : 'batch', ops })
      return init?.keepalive ? json(200) : new Promise<Response>(r => { release = r })
    })
    const first = l.flush() // sends the seeded row
    await vi.waitFor(() => expect(bodies.length).toBe(1))
    release(json(200))
    await first // memory now mirrors the (empty) outbox
    await d._outbox.bulkAdd([row(1), row(2)])
    l.queued([row(1), row(2)])
    const inFlight = l.flush()
    await vi.waitFor(() => expect(bodies.length).toBe(2))
    l.flushOnHide()
    expect(bodies.at(-1)).toEqual({ kind: 'keepalive', ops: ['op-1', 'op-2'] })
    release(json(200))
    await inFlight
    l.stop()
  })

  it('I2: a later page hide sends the unacknowledged rows again; only an identical send within ~1 s is skipped', async () => {
    const posts: string[][] = []
    let t = 1_000_000
    const l = loop(async (_u, init) => { if (init?.keepalive) posts.push(JSON.parse(String(init.body)).ops.map((o: { opId: string }) => o.opId)); return json(200) }, { now: () => t })
    await l.flush()
    l.queued([row(1), row(2)])
    l.flushOnHide()
    t += 300
    l.flushOnHide() // the same set right away (pagehide + visibilitychange): skipped
    t += 2000
    l.flushOnHide() // later (hidden again): sent again, the server dedupes by opId
    l.queued([row(3)])
    l.flushOnHide() // a different set: sent at once
    expect(posts).toEqual([['op-1', 'op-2'], ['op-1', 'op-2'], ['op-1', 'op-2', 'op-3']])
    l.stop()
  })

  it('pagehide and visibilitychange do not double-send the same rows', async () => {
    const posts: number[] = []
    const l = loop(async (_u, init) => { if (init?.keepalive) posts.push(JSON.parse(String(init.body)).ops.length); return json(200) })
    l.start()
    await vi.waitFor(() => expect(states.at(-1)).toBe('saved'))
    l.queued([row(1), row(2)])
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('pagehide'))
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    expect(posts).toEqual([2])
    l.stop()
  })

  it('sizes the body in bytes (TextEncoder), not UTF-16 units', async () => {
    const sent: number[] = []
    const l = loop(async (_u, init) => { if (init?.keepalive) sent.push(new TextEncoder().encode(String(init.body)).length); return json(200) })
    const wide = 'é'.repeat(5000) // 5000 chars, 10000 bytes
    await l.flush()
    l.queued(Array.from({ length: 10 }, (_, i) => ({ ...row(i), doc: { id: `t${i}`, s: wide } })))
    l.flushOnHide()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toBeLessThanOrEqual(KEEPALIVE_LIMIT_BYTES)
    l.stop()
  })
})

describe('Addendum 3: every post carries the writer token', () => {
  it('POST /db/ops (and the page-hide keepalive) send X-Dojo-Writer', async () => {
    await seed(1)
    const seen: (string | null)[] = []
    const l = loop(async (_u, init) => { seen.push(new Headers(init?.headers).get('X-Dojo-Writer')); return json(200) }, { writerHeaders: () => ({ 'X-Dojo-Writer': 'tok' }) })
    expect(await l.flush()).toBe(true)
    l.queued([row(9)])
    l.flushOnHide()
    expect(seen).toEqual(['tok', 'tok'])
  })
})

describe('G4 #1: 403 not_writer is not "server down"', () => {
  it('stops retrying and says to reopen Dojo from the Dojo app', async () => {
    await seed(1)
    let calls = 0
    const reasons: string[] = []
    const l = loop(async () => { calls++; return json(403, { ok: false, error: { code: 'not_writer', message: 'x' } }) }, {
      backoffMs: [5], setState: (st: SaveState, why?: string) => { states.push(st); if (why) reasons.push(why) },
    })
    expect(await l.flush()).toBe(false)
    await new Promise(r => setTimeout(r, 60))
    expect(calls).toBe(1) // no backoff retries
    expect(states.at(-1)).toBe('offline')
    expect(reasons.at(-1)).toBe(NOT_WRITER_MESSAGE)
    expect(await d._outbox.count()).toBe(1) // kept for when the token is back
    expect(await l.flush()).toBe(false) // a later flush (e.g. the health ping's) sends nothing
    expect(calls).toBe(1)
    l.stop()
  })
})

describe('the health ping (UAT cu-2 P3-13)', () => {
  const health = (dbId = 'db1') => json(200, { ok: true, dbId })
  const tick = (ms: number) => new Promise(r => setTimeout(r, ms))

  it('one missed ping with nothing waiting is not "Not saved to disk"; the next good one stays Saved', async () => {
    let calls = 0
    const l = loop(async () => { calls++; if (calls === 1) throw new TypeError('timed out'); return health() }, { pollMs: 20 })
    l.start()
    await tick(120)
    l.stop()
    expect(calls).toBeGreaterThanOrEqual(3)
    expect(states).not.toContain('offline')
    expect(states.at(-1)).toBe('saved')
  })

  it('two missed pings in a row are "Not saved to disk", and the first good one clears it', async () => {
    let calls = 0
    const l = loop(async () => { calls++; if (calls <= 2) throw new TypeError('down'); return health() }, { pollMs: 20 })
    l.start()
    await tick(160)
    l.stop()
    expect(states).toContain('offline')
    expect(states.at(-1)).toBe('saved')
    expect(states.indexOf('offline')).toBeGreaterThan(-1)
  })

  it('with changes waiting a missed ping is reported at once', async () => {
    await seed(1)
    const l = loop(async () => { throw new TypeError('down') }, { pollMs: 20, backoffMs: [10_000] })
    l.start()
    await tick(80)
    l.stop()
    expect(states).toContain('offline')
  })
})

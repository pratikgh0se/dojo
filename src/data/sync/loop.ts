// Flushes the outbox to POST /db/ops: batches of up to 500, about 300 ms after the last write, on
// pagehide / hidden, with backoff while the server is unreachable. Rows are deleted only after a 200.
// The server ignores op ids it has already seen, so retries and the page-hide fast path are safe.
import type { DojoDB, OutboxRow } from '../db'
import { APPEND_ONLY, diskIdOf, toDiskDoc } from './diskIds'
import { idToKey } from './keys'
import { sameValue } from './middleware'
import { NOT_WRITER_MESSAGE, setRejectedCount, setSaveState, type SaveState } from './status'
import { writerHeaders } from '../writer'

export const BATCH_SIZE = 500
export const KEEPALIVE_LIMIT_BYTES = 60_000
const MEMORY_CAP = 5000
/** I2: at most this many refused ops are parked; after that they stay queued (never dropped). */
export const REJECTED_CAP = 200

/** A refused op, parked in _meta.rejectedOps with the server's reason. */
export type ParkedOp = OutboxRow & { error?: string }

export interface LoopOptions {
  db: DojoDB
  clientId: string
  base?: string
  fetchImpl?: typeof fetch
  debounceMs?: number
  /** Retry delays in ms; the last one repeats. */
  backoffMs?: number[]
  pollMs?: number
  setState?: (s: SaveState, reason?: string) => void
  /**
   * C2: the server database this browser adopted (_meta.syncedDb), or null. Nothing is ever posted
   * while null, and every post is stamped with it so another database refuses it (409 db_mismatch).
   */
  adoptedDb?: string | null
  /** Called when the server's database is not the adopted one (ping or a db_mismatch answer). */
  onMismatch?: () => void
  rejectedCap?: number
  /** I10: each POST /db/ops gives up after this long (default 15 s); health pings after 3 s. */
  postTimeoutMs?: number
  /** The clock the page-hide duplicate check uses (tests). */
  now?: () => number
  /** Addendum 3: the X-Dojo-Writer header every post carries. */
  writerHeaders?: () => Record<string, string>
}

export interface SyncLoop {
  /** Feed rows from the middleware's onQueued. */
  queued(rows: OutboxRow[]): void
  /** Send everything pending now; resolves when the outbox is empty or the server failed. */
  flush(): Promise<boolean>
  /** Page-hide fast path: synchronous send of committed-but-unsent rows with fetch keepalive. */
  flushOnHide(): void
  start(): void
  stop(): void
  /** Set (after a successful adoption) or clear the adopted server database. */
  adopt(dbId: string | null): void
  adoptedDb(): string | null
  /** I2: parked (refused) ops, and putting them back in the outbox. */
  listRejected(): Promise<ParkedOp[]>
  retryRejected(): Promise<boolean>
}

const toOp = (r: OutboxRow) => ({ tbl: r.tbl, op: r.op, id: r.id, doc: r.doc, at: r.at, opId: r.opId, ...(r.create ? { create: true } : {}), ...(r.known ? { known: true } : {}) })

export function createSyncLoop(o: LoopOptions): SyncLoop {
  const f: typeof fetch = o.fetchImpl ?? ((i, n) => globalThis.fetch(i, n))
  const base = o.base ?? ''
  const debounceMs = o.debounceMs ?? 300
  const backoff = o.backoffMs ?? [500, 1000, 2000, 4000, 5000]
  const set = o.setState ?? setSaveState
  const memory = new Map<string, OutboxRow>() // committed rows not yet acknowledged, keyed by opId
  // I-a: true only while `memory` holds EVERY outbox row. Set when a flush sees the outbox empty (every
  // row committed after that read reaches queued()); cleared on start (rows from an earlier page load),
  // adoption, eviction and retry. The hide path sends only then, so it can never overtake an older row.
  let complete = false
  let running: Promise<boolean> | null = null
  let again = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null
  let poll: ReturnType<typeof setInterval> | null = null
  let failures = 0
  let stopped = false
  let cleanup: (() => void) | null = null
  let adopted: string | null = o.adoptedDb ?? null
  let notWriter = false // G4 #1: sticky until the page is reopened with the current token
  const rejectedCap = o.rejectedCap ?? REJECTED_CAP

  const postTimeoutMs = o.postTimeoutMs ?? 15_000
  const post = (path: string, body: unknown, keepalive = false) =>
    f(`${base}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(o.writerHeaders ?? writerHeaders)() }, body: JSON.stringify(body), keepalive,
      // I10: a hung server must not hang the queue (or boot, which flushes before it hydrates).
      ...(keepalive ? {} : { signal: AbortSignal.timeout(postTimeoutMs) }),
    })

  function mismatch() {
    adopted = null
    o.onMismatch?.()
  }

  const restoring = async () => {
    const v = (await o.db._meta.get('restoring'))?.value as { at?: number } | undefined
    return !!v && typeof v.at === 'number' && Date.now() - v.at < 5 * 60_000
  }

  let why = '' // the server's reason for the last rejected batch

  async function sendBatch(rows: OutboxRow[]): Promise<'ok' | 'down' | 'rejected' | 'mismatch' | 'not_writer'> {
    if (!adopted) return 'mismatch'
    try {
      const res = await post('/db/ops', { clientId: o.clientId, dbId: adopted, ops: rows.map(toOp) })
      if (res.ok) {
        // A 200 that is not the server's JSON (e.g. an SPA fallback page) is not an acknowledgement.
        const ack = await res.json().catch(() => null) as { ok?: unknown } | null
        return ack?.ok === true ? 'ok' : 'down'
      }
      // Only the server's own "this op is malformed / too big / collides" answers park an op; anything else
      // (404 from some other server, 403, 5xx, 429...) is treated as the server being unavailable and retried.
      const err = await res.json().catch(() => null) as { error?: { code?: unknown; message?: unknown } } | null
      why = `HTTP ${res.status}${typeof err?.error?.message === 'string' ? `: ${err.error.message}` : ''}`
      if (res.status === 400 || res.status === 413 || res.status === 422) return 'rejected'
      if (res.status === 409 && err?.error?.code === 'conflict') return 'rejected' // I3: an append-only id collision
      if (res.status === 409 && err?.error?.code === 'db_mismatch') return 'mismatch' // C2: not the database we adopted
      if (res.status === 403 && err?.error?.code === 'not_writer') return 'not_writer' // G4 #1: a stale or missing token
      return 'down'
    } catch {
      return 'down'
    }
  }

  async function drop(rows: OutboxRow[]) {
    await o.db._outbox.bulkDelete(rows.map(r => r.seq as number))
    rows.forEach(r => memory.delete(r.opId))
  }

  const parkedRows = async (): Promise<ParkedOp[]> => {
    const v = (await o.db._meta.get('rejectedOps'))?.value
    return Array.isArray(v) ? (v as ParkedOp[]) : []
  }

  /**
   * I2: a permanently rejected op must not wedge the queue, so it moves (in one transaction) from the
   * outbox to _meta.rejectedOps, where Settings lists it with a Retry. At the cap nothing more is
   * parked: the op stays queued (never dropped) and the status says why. False when capped.
   */
  async function quarantine(row: OutboxRow): Promise<boolean> {
    const parked = await o.db.transaction('rw', o.db._outbox, o.db._meta, async () => {
      const prev = await parkedRows()
      if (prev.length >= rejectedCap) return false
      await o.db._meta.put({ key: 'rejectedOps', value: [...prev, { ...row, error: why }] })
      await o.db._outbox.delete(row.seq as number)
      setRejectedCount(prev.length + 1)
      return true
    })
    if (parked) {
      memory.delete(row.opId)
      console.error('dojo: the server refused a change; listed in Settings (changes that could not be saved)', row)
    }
    return parked
  }

  async function run(): Promise<boolean> {
    for (;;) {
      if (!adopted) return false // C2: never post to a database this browser has not adopted
      if (notWriter) { set('offline', NOT_WRITER_MESSAGE); return false }
      if (await restoring()) return false // I-c: a restore is under way in some tab
      const rows = await o.db._outbox.orderBy('seq').limit(BATCH_SIZE).toArray()
      if (rows.length === 0) {
        complete = true
        failures = 0
        set('saved')
        return true
      }
      // ruling 16 Q22: a background retry while the server is down keeps "Not saved to disk"; the status leaves it
      // only once a write is accepted again (the 'ok' path below, then 'saved' when the outbox is empty)
      if (failures === 0) set('saving')
      const r = await sendBatch(rows)
      if (r === 'ok') {
        await drop(rows)
        failures = 0
        continue
      }
      if (r === 'mismatch') {
        mismatch()
        return false
      }
      if (r === 'not_writer') {
        // G4 #1: not "server down": no retries; the changes wait in the outbox until the app is reopened
        // from Dojo.app, which brings the current token.
        notWriter = true
        set('offline', NOT_WRITER_MESSAGE)
        return false
      }
      let down = r === 'down'
      if (r === 'rejected') {
        // Find the poison op(s): send one by one.
        for (const row of rows) {
          const one = rows.length === 1 ? r : await sendBatch([row])
          if (one === 'ok') await drop([row])
          else if (one === 'mismatch') { mismatch(); return false }
          else if (one === 'not_writer') { notWriter = true; set('offline', NOT_WRITER_MESSAGE); return false }
          else if (one === 'down') { down = true; break }
          else if (!(await quarantine(row))) {
            set('offline', `The server refused ${rejectedCap} changes; the rest wait until those are retried (${why}).`)
            return false
          }
        }
      }
      if (!down) continue
      failures += 1
      set('offline', 'The Dojo server is not reachable.')
      schedule(backoff[Math.min(failures - 1, backoff.length - 1)])
      return false
    }
  }

  /**
   * The parked op, if it still describes this browser's current state of its doc. A newer op for the
   * same doc (sent or pending) means the parked one is out of date: re-sending it would roll the disk
   * back, so it is dropped instead.
   */
  async function stillCurrent(p: ParkedOp): Promise<boolean> {
    const t = o.db.tables.find(x => x.name === p.tbl)
    if (!t) return false
    if (p.op === 'clear') return (await t.count()) === 0
    let row: unknown
    if (APPEND_ONLY.has(p.tbl)) row = (await t.toArray()).find(r => diskIdOf(p.tbl, (r as { seq?: number }).seq, r, o.clientId) === p.id)
    else row = await t.get(idToKey(p.tbl, p.id as string) as string)
    if (p.op === 'delete') return row === undefined
    if (row === undefined) return false
    const strip = (d: unknown) => { const { _ofDiskId: _o, ...rest } = (d ?? {}) as Record<string, unknown>; return rest }
    return sameValue(strip(toDiskDoc(p.tbl, p.id as string, row)), strip(p.doc))
  }

  /**
   * Puts parked ops back into the outbox (same opIds, original order) and flushes. A parked op that a
   * newer op for the same doc has superseded is dropped, never re-sent after it.
   */
  async function retryRejected(): Promise<boolean> {
    complete = false // the re-queued rows are not in memory
    await o.db.transaction('rw', o.db.tables, async () => {
      const parked = await parkedRows()
      if (!parked.length) return
      const keep: OutboxRow[] = []
      for (const p of parked) {
        if (await stillCurrent(p)) {
          const { seq: _seq, error: _error, ...r } = p
          keep.push(r)
        }
      }
      if (keep.length) {
        // Ahead of anything queued since: give them the lowest seqs by re-adding the newer rows after.
        const newer = await o.db._outbox.orderBy('seq').toArray()
        await o.db._outbox.clear()
        await o.db._outbox.bulkAdd([...keep, ...newer.map(({ seq: _s, ...r }) => r)])
        for (const r of newer) memory.delete(r.opId)
      }
      await o.db._meta.delete('rejectedOps')
    })
    setRejectedCount(0)
    return flush()
  }

  function flush(): Promise<boolean> {
    if (running) {
      again = true
      return running
    }
    running = (async () => {
      try {
        let ok = await run()
        while (ok && again) {
          again = false
          ok = await run()
        }
        return ok
      } catch (e) {
        console.error('dojo: sync flush failed', e)
        set('offline', 'Saving to disk failed; retrying.')
        schedule(backoff[backoff.length - 1])
        return false
      } finally {
        running = null
        again = false
      }
    })()
    return running
  }

  function schedule(ms: number) {
    if (stopped) return
    if (retry) clearTimeout(retry)
    retry = setTimeout(() => { retry = null; void flush() }, ms)
  }

  function queued(rows: OutboxRow[]) {
    for (const r of rows) memory.set(r.opId, r)
    while (memory.size > MEMORY_CAP) {
      memory.delete(memory.keys().next().value as string)
      complete = false
    }
    if (stopped || !adopted) return
    if (failures === 0) set('saving')
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; void flush() }, debounceMs)
  }

  let lastHide: { key: string; at: number } | null = null
  const now = o.now ?? (() => Date.now())

  /**
   * Page-hide fast path: one keepalive POST of every committed, unacknowledged row, in order. I2: that
   * includes rows of a batch still in flight (an ordinary request dies with the page) and rows an earlier
   * hide already sent (it may not have arrived); the server ignores opIds it has seen. Only the very same
   * send within about a second (pagehide and visibilitychange usually fire together) is skipped. It sends
   * only while memory mirrors the whole outbox (I-a), and keeps the body under the keepalive byte limit.
   */
  function flushOnHide() {
    if (timer) { clearTimeout(timer); timer = null }
    if (!adopted || !complete || notWriter) return
    const enc = new TextEncoder()
    const envelope = { clientId: o.clientId, dbId: adopted, ops: [] as ReturnType<typeof toOp>[] }
    let size = enc.encode(JSON.stringify(envelope)).length
    for (const r of memory.values()) {
      const op = toOp(r)
      const n = enc.encode(JSON.stringify(op)).length + (envelope.ops.length ? 1 : 0) // + the comma
      if (size + n > KEEPALIVE_LIMIT_BYTES) break
      size += n
      envelope.ops.push(op)
    }
    if (envelope.ops.length === 0) return
    const key = envelope.ops.map(x => x.opId).join(',')
    if (lastHide && lastHide.key === key && now() - lastHide.at < 1000) return
    lastHide = { key, at: now() }
    void post('/db/ops', envelope, true).catch(() => {})
  }

  let pingFailures = 0
  async function ping() {
    try {
      const res = await f(`${base}/db/health`, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) throw new Error(String(res.status))
      const h = await res.json() as { dbId?: unknown }
      if (await restoring()) return // I-c: the restoring tab finishes it; this one reloads
      if (typeof h?.dbId !== 'string' || h.dbId !== adopted) return mismatch() // re-adopt, never post
      pingFailures = 0
      if (!running && (await o.db._outbox.count()) === 0) set('saved')
      else if (!running) void flush()
    } catch {
      // UAT cu-2 P3-13: one missed health ping (a busy moment: a window resize or zoom, a stall, a slow reply) is not
      // news while nothing is waiting to be saved; "Not saved to disk" needs the second miss in a row. With changes
      // pending, the flush's own failure path reports at once, as before.
      pingFailures += 1
      if (!running && (pingFailures >= 2 || (await o.db._outbox.count()) > 0)) set('offline', 'The Dojo server is not reachable.')
    }
  }

  return {
    queued, flush, flushOnHide,
    adopt(dbId) {
      // N1: adoption drops the outbox rows its snapshot covered (hydrate's adoptInTx); anything the
      // page-hide fast path remembered from before must go too, or it would replay them later.
      adopted = dbId
      memory.clear()
      lastHide = null
      complete = false
    },
    listRejected: parkedRows,
    retryRejected,
    adoptedDb: () => adopted,
    start() {
      stopped = false
      complete = false // the outbox may hold rows from an earlier page load
      // One path for both events: flushOnHide skips rows an earlier hide event already sent.
      const onHide = (e: Event) => { if (e.type === 'pagehide' || document.visibilityState === 'hidden') flushOnHide() }
      if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', onHide)
        document.addEventListener('visibilitychange', onHide)
        cleanup = () => {
          window.removeEventListener('pagehide', onHide)
          document.removeEventListener('visibilitychange', onHide)
        }
      }
      poll = setInterval(() => void ping(), o.pollMs ?? 10_000)
      void parkedRows().then(p => setRejectedCount(p.length), () => {})
      void flush()
    },
    stop() {
      stopped = true
      for (const t of [timer, retry]) if (t) clearTimeout(t)
      timer = retry = null
      if (poll) clearInterval(poll)
      poll = null
      cleanup?.()
      cleanup = null
    },
  }
}

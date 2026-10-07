// Boot-time reconciliation between Dexie (working copy) and the disk server (source of truth).
//
// Addendum 3: one writer (the browser holding the writer token), fresh start, no import of foreign
// data. A browser syncs only to the server database it adopted (_meta.syncedDb === the server's db_id):
//   - adopted:                           flush the outbox, then replace Dexie with the disk's state;
//   - never synced, and the disk empty:  the fresh start. The writer's database was created by this
//                                        version with the outbox recorder installed, so its outbox
//                                        holds everything it ever wrote: adopt and send it;
//   - anything else:                     the disk wins. Dexie is replaced with the disk's state and
//                                        the outbox (writes meant for no or another database) is dropped.
// Read-only browsers (no token) only ever copy the disk's state into their own database.
import type { Table } from 'dexie'
import type { DojoDB } from '../db'
import { APPEND_ONLY, fromDiskDocs } from './diskIds'
import { newOpId } from './keys'
import type { SyncGate } from './middleware'
import type { SyncLoop } from './loop'
import { setSaveState } from './status'
import { READ_ONLY_MESSAGE } from '../writer'

/**
 * kept: Dexie stays as it is: changes the server refused are parked (I2), or the replace kept losing
 * races with new writes (I7).
 */
export type HydrateResult = 'unreachable' | 'restored' | 'fresh' | 'failed' | 'kept' | 'paused' | 'readonly'

/** I-c: set in _meta while a restore is under way (by the tab that started it). */
export interface RestoringFlag { fromDb: string | null; at: number }
/** A restore that has not swapped the database after this long is treated as abandoned. */
export const RESTORE_STALE_MS = 5 * 60_000
/** Past this, even a restore that did start is treated as over (it rolled back, or the server died). */
export const RESTORE_ABANDON_MS = 30 * 60_000

export async function getRestoring(db: DojoDB): Promise<RestoringFlag | null> {
  const v = (await db._meta.get('restoring'))?.value as RestoringFlag | undefined
  return v && typeof v === 'object' ? v : null
}

/** How often a replace is retried when writes keep arriving between the flush and the replace. */
export const REPLACE_ATTEMPTS = 3

export interface HydrateOptions {
  db: DojoDB
  gate: SyncGate
  loop: SyncLoop
  clientId: string
  base?: string
  fetchImpl?: typeof fetch
  /** Per-request time limits in ms. */
  timeouts?: { health?: number; state?: number }
  /** Addendum 3: no writer token: show the disk's state, change nothing, adopt nothing. */
  readOnly?: boolean
}

const appTables = (db: DojoDB): Table[] => db.tables.filter(t => !t.name.startsWith('_'))

export async function getClientId(db: DojoDB): Promise<string> {
  const have = (await db._meta.get('clientId'))?.value
  if (typeof have === 'string' && have) return have
  const id = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  await db._meta.put({ key: 'clientId', value: id })
  return id
}

export async function getSyncedDb(db: DojoDB): Promise<string | null> {
  const v = (await db._meta.get('syncedDb'))?.value
  return typeof v === 'string' && v ? v : null
}

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

export async function hydrate(o: HydrateOptions): Promise<HydrateResult> {
  const f: typeof fetch = o.fetchImpl ?? ((i, n) => globalThis.fetch(i, n))
  const base = o.base ?? ''
  const limit = { health: 3000, state: 15_000, ...o.timeouts }
  const unreachable = 'The Dojo server is not reachable.'

  let health: { dbId?: unknown; docs: number }
  try {
    const res = await f(`${base}/db/health`, { signal: AbortSignal.timeout(limit.health) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    health = await res.json()
    if (typeof health?.dbId !== 'string' || !health.dbId) throw new Error('no database id')
  } catch {
    setSaveState('offline', unreachable)
    return 'unreachable'
  }
  const dbId = health.dbId as string

  async function getState(): Promise<Record<string, unknown[]>> {
    const res = await f(`${base}/db/state`, { signal: AbortSignal.timeout(limit.state) })
    if (!res.ok) throw new HttpError(res.status, 'state', `reading the disk failed (HTTP ${res.status})`)
    return ((await res.json()) as { tables: Record<string, unknown[]> }).tables
  }

  /**
   * A browser restored from an old copy of its profile (Time Machine) keeps its clientId but an older
   * key generator, so its next rows would reuse disk ids it already wrote. Probe each append-only
   * table's next key (a throwaway add, deleted at once); if it is not past the highest seq on disk for
   * this clientId, switch to a new clientId. Runs inside the replace transaction.
   */
  async function checkClientId(tables: Record<string, unknown[]>): Promise<string | null> {
    const cid = o.gate.clientId ?? o.clientId
    for (const name of APPEND_ONLY) {
      let maxDisk = 0
      for (const d of tables[name] ?? []) {
        const id = (d as { _diskId?: unknown })._diskId
        if (typeof id === 'string' && id.startsWith(`${cid}:`)) maxDisk = Math.max(maxDisk, Number(id.slice(cid.length + 1)) || 0)
      }
      if (maxDisk === 0) continue
      const t = o.db.table(name)
      const next = (await t.add({})) as number
      await t.delete(next)
      if (next <= maxDisk) {
        const fresh = newOpId()
        await o.db._meta.put({ key: 'clientId', value: fresh })
        return fresh
      }
    }
    return null
  }

  /** Replaces every app table with the server's docs, without echoing the writes back as ops. */
  async function fill(tables: Record<string, unknown[]>, check?: () => Promise<void>, after?: () => Promise<void>) {
    const mine = appTables(o.db)
    let regenerated: string | null = null
    o.gate.bypass = true
    try {
      await o.db.transaction('rw', [...mine, o.db._outbox, o.db._meta], async () => {
        await check?.()
        for (const t of mine) {
          await t.clear()
          const docs = tables[t.name]
          if (docs?.length) await t.bulkPut(fromDiskDocs(t.name, docs)) // I3: fresh local seqs
        }
        regenerated = await checkClientId(tables)
        await after?.()
      })
    } finally {
      o.gate.bypass = false
    }
    if (regenerated) {
      console.warn('dojo: this browser is an older copy of itself; using a new client id', regenerated)
      o.gate.clientId = regenerated
    }
  }

  const outboxEmpty = async () => {
    if ((await o.db._outbox.count()) > 0) throw new HttpError(0, 'queued', 'a write arrived during the replace')
  }

  /** Records the adoption (syncedDb; everSynced is never cleared, not even by a restore's wipe). */
  async function adoptInTx() {
    await o.db._meta.put({ key: 'syncedDb', value: dbId })
    await o.db._meta.put({ key: 'everSynced', value: true })
  }

  /**
   * Adopted: send what this browser wrote while away, then take the server's state. I7: the replace
   * transaction includes _outbox and aborts if anything is queued (a write that raced the fetch would
   * otherwise be wiped from Dexie); it then flushes and tries again.
   */
  async function restoreFromServer(): Promise<HydrateResult> {
    for (let i = 0; i < REPLACE_ATTEMPTS; i++) {
      if (!(await o.loop.flush())) return 'unreachable'
      // I2: changes the server refused live only in this Dexie; never replace it while any are parked.
      if ((await o.loop.listRejected()).length) return 'kept'
      const tables = await getState()
      try {
        await fill(tables, outboxEmpty)
        return 'restored'
      } catch (e) {
        if (!(e instanceof HttpError && e.code === 'queued')) throw e
      }
    }
    return 'kept'
  }

  /** The fresh start: adopt the empty disk, then send everything this browser recorded. */
  async function freshStart(): Promise<HydrateResult> {
    o.gate.bypass = true
    try {
      await o.db.transaction('rw', o.db._meta, () => adoptInTx())
    } finally {
      o.gate.bypass = false
    }
    o.loop.adopt(dbId)
    return (await o.loop.flush()) ? 'fresh' : 'unreachable'
  }

  /** The disk wins: replace Dexie with its state, drop the outbox, adopt, in one transaction. */
  async function takeDisk(): Promise<HydrateResult> {
    const tables = await getState()
    let dropped = 0
    await fill(tables, async () => {
      dropped = await o.db._outbox.count()
      await o.db._outbox.clear()
      await adoptInTx()
    })
    if (dropped) console.warn(`dojo: ${dropped} change(s) made before this browser synced were dropped; the disk wins`)
    o.loop.adopt(dbId)
    return 'restored'
  }

  async function restoreStartedSince(at: number): Promise<boolean> {
    try {
      const res = await f(`${base}/db/backups`, { signal: AbortSignal.timeout(limit.health) })
      if (!res.ok) return true // cannot tell: keep waiting
      const { backups } = (await res.json()) as { backups: { file: string; at: string }[] }
      return backups.some(b => b.file.startsWith('pre-restore-') && Date.parse(b.at) > at)
    } catch {
      return true
    }
  }

  /**
   * I-c: this browser started a restore. If the server's database is still the one it restored from, the
   * restore has not happened yet (another tab is doing it): stay paused, unless that is long stale. If
   * it changed, finish the restore: replace the pre-restore copy with the restored database and adopt
   * it. Never a merge: the old copy must not flow back into the restored database.
   */
  async function finishRestore(flag: RestoringFlag): Promise<HydrateResult | null> {
    if (flag.fromDb === dbId) {
      const age = Date.now() - flag.at
      if (age < RESTORE_STALE_MS) return 'paused'
      // Minor 1: stale, but a restore that started after the flag (its pre-restore copy exists) may
      // still be finishing on a big database: stay paused a while longer rather than resume on it.
      if (age < RESTORE_ABANDON_MS && (await restoreStartedSince(flag.at))) return 'paused'
      await o.db._meta.delete('restoring') // abandoned: nothing was restored
      return null
    }
    o.loop.adopt(null)
    const tables = await getState()
    await fill(tables, async () => {
      await o.db._outbox.clear()
      await adoptInTx()
      await o.db._meta.delete('restoring')
    })
    o.loop.adopt(dbId)
    return 'restored'
  }

  if (o.readOnly) {
    // A read-only browser: its own database (dojo-view) mirrors the disk; nothing goes the other way.
    try {
      await fill(await getState())
    } catch (e) {
      console.warn('dojo: could not load the disk state', e)
      setSaveState('offline', READ_ONLY_MESSAGE)
      return 'failed' // ruling 11 Q10: the caller decides between the local copy and the error card
    }
    setSaveState('offline', READ_ONLY_MESSAGE)
    return 'readonly'
  }

  let result: HydrateResult
  try {
    const flag = await getRestoring(o.db)
    const finished = flag ? await finishRestore(flag) : null
    if (finished) {
      result = finished
    } else if ((await getSyncedDb(o.db)) === dbId) {
      o.loop.adopt(dbId)
      result = await restoreFromServer()
    } else {
      o.loop.adopt(null) // C2: nothing is posted until this browser has adopted this database
      const neverSynced = !(await o.db._meta.get('everSynced')) && !(await getSyncedDb(o.db))
      result = health.docs === 0 && neverSynced ? await freshStart() : await takeDisk()
    }
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e)
    console.warn('dojo: not saved to disk:', why)
    setSaveState('offline', `Not saved to disk: ${why}`)
    return 'failed'
  }
  if (result === 'unreachable') setSaveState('offline', unreachable)
  else if (result === 'paused') setSaveState('offline', 'A backup is being restored.')
  else setSaveState('saved')
  return result
}

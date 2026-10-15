import { FLAT_TABLES, type FlatState } from '../rules/flatState'
import { migrateToFlat } from '../rules/migrateToFlat'
import type { PlanV2 } from './planV2'
import type { ReplanReport } from './types'
import { DEFAULT_SETTINGS, getSettings, type DojoDB } from './db'
import { remapTables } from './remapActions'
import { now as appNow } from '../lib/clock'
import { sameValue, type SyncGate } from './sync/middleware'
import { syncControls } from './sync/status'
import { writerHeaders } from './writer'

export class MigrationBackupError extends Error {
  constructor(message: string) { super(message); this.name = 'MigrationBackupError' }
}

/** How long the pre-migration backup request may take (it runs while the cross-tab lock is held). */
export const BACKUP_TIMEOUT_MS = 30_000

export interface FlatRunOptions {
  now?: number
  backup?: () => Promise<string | null>
  gate?: SyncGate
  /** Test seam: runs between the "will a report be emitted" peek and the transaction. */
  afterPeek?: () => Promise<void>
}
export interface FlatRunResult { migrated: boolean; writes: number; report: ReplanReport | null }

const byId = (r: { id: string }) => r.id
const keyOf: Record<string, (r: never) => string> = {
  tickets: byId, sessions: byId, redos: byId, rungUses: byId, checkAttempts: byId, grades: byId, bankItems: byId, designSessions: byId,
  events: (r: { seq: number }) => String(r.seq), aiLog: (r: { seq: number }) => String(r.seq),
  code: (r: { ticketId: string; lang: string }) => `${r.ticketId}\u0000${r.lang}`, pictures: (r: { key: string }) => r.key,
}

/** Rows to put (new or changed, by primary key) and keys to delete; never a table clear, so the outbox group holds only put/delete ops. */
function diffTable(name: string, before: unknown[], after: unknown[]): { puts: unknown[]; deletes: string[] } {
  const k = keyOf[name] as (r: unknown) => string
  const was = new Map(before.map(r => [k(r), r]))
  const now = new Map(after.map(r => [k(r), r]))
  return {
    puts: after.filter(r => !sameValue(was.get(k(r)), r)),
    deletes: [...was.keys()].filter(key => !now.has(key)),
  }
}

async function readState(d: DojoDB): Promise<FlatState> {
  const out: Record<string, unknown> = {}
  for (const name of FLAT_TABLES) out[name] = await d.table(name).toArray()
  out.settings = await getSettings(d)
  return out as unknown as FlatState
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  if (!locks) return fn()
  return (await locks.request('dojo-flat-migration', fn)) as T
}

/** Reads, migrates in memory, and writes only what changed, in one transaction (a second run writes nothing). */
export async function runFlatMigration(d: DojoDB, plan: PlanV2, opts: FlatRunOptions = {}): Promise<FlatRunResult> {
  if (opts.gate?.readOnly) return { migrated: false, writes: 0, report: null }
  const now = opts.now ?? appNow()
  return withLock(async () => {
    // Under the lock, so a second tab sees the first tab's result and takes no second backup (MIG-02, MIG-18).
    const peek = await readState(d)
    const hasSplit = peek.tickets.some(t => ((t as { children?: string[] }).children?.length ?? 0) > 0)
    const willReport = (peek.settings.modelVersion !== 2 && peek.tickets.length > 0) || hasSplit
    let backedUp = false
    let backupFile: string | null = null
    if (willReport && opts.backup) { backupFile = await opts.backup(); backedUp = true }
    await opts.afterPeek?.()

    for (let redo = false; ; redo = true) {
      try {
        return await migrateOnce(d, plan, now, backupFile, backedUp || !opts.backup, opts.gate)
      } catch (e) {
        if (!(e instanceof NeedsBackup)) throw e
        // A report turned out to be due although the peek said no: nothing was written; take the backup and go again, once.
        if (redo || !opts.backup) throw new MigrationBackupError('Dojo needed a backup partway through upgrading your data and could not take one, so it changed nothing.')
        backupFile = await opts.backup()
        backedUp = true
      }
    }
  })
}

class NeedsBackup extends Error {}

async function migrateOnce(d: DojoDB, plan: PlanV2, now: number, backupFile: string | null, backedUp: boolean, gate?: SyncGate): Promise<FlatRunResult> {
  try {
    return await d.transaction('rw', [...remapTables(d), d.settings], async (): Promise<FlatRunResult> => {
      // N5: `gate.group` is the only thing that stamps `grp` on queued rows. It is set here, inside the single migration
      // transaction, and cleared in the finally below, so a UI write issued while the shell renders on the not-yet-migrated
      // copy (before this runs, or after it ends) is queued as an ordinary single op and never joins the atomic group.
      if (gate) gate.group = `flat-migration:${now}`
      const before = await readState(d)
      const res = migrateToFlat(before, plan, { now, backupFile })
      if (res.report !== null && !backedUp) throw new NeedsBackup() // aborts the transaction: nothing is written
      let writes = 0
      for (const name of FLAT_TABLES) {
        const { puts, deletes } = diffTable(name, before[name] as unknown[], res.next[name] as unknown[])
        if (deletes.length) {
          const keys = deletes.map(key => (name === 'code' ? key.split('\u0000') : name === 'events' || name === 'aiLog' ? Number(key) : key))
          await d.table(name).bulkDelete(keys)
        }
        if (puts.length) await d.table(name).bulkPut(puts)
        writes += puts.length + deletes.length
      }
      if (!sameValue(before.settings, { ...res.next.settings, id: 'main' })) {
        await d.settings.put({ ...res.next.settings, id: 'main' })
        writes++
      }
      for (const e of res.newEvents) { await d.events.add(e as never); writes++ }
      return { migrated: res.report !== null || before.settings.modelVersion !== 2, writes, report: res.report }
    })
  } finally {
    if (gate) gate.group = undefined
  }
}

/** `POST /db/backup` (the Settings "Back up now"): a manual snapshot, returned by file name; null when the app runs without a disk server. */
export async function backupBeforeMigration(f: typeof fetch = (...a) => fetch(...a), timeoutMs = BACKUP_TIMEOUT_MS): Promise<string | null> {
  if (import.meta.env.VITE_DOJO_DISK === 'off') return null
  let res: Response
  try {
    await syncControls.flush().catch(() => false) // the snapshot must hold everything this browser has already queued
    res = await f('/db/backup', { method: 'POST', headers: { 'Content-Type': 'application/json', ...writerHeaders() }, body: '{}', signal: AbortSignal.timeout(timeoutMs) })
  } catch (e) {
    throw new MigrationBackupError(`Dojo could not take a backup before upgrading your data, so it changed nothing: ${String(e)}`)
  }
  if (!res.ok) throw new MigrationBackupError(`Dojo could not take a backup before upgrading your data (HTTP ${res.status}), so it changed nothing.`)
  const body = (await res.json().catch(() => null)) as { file?: unknown } | null
  // Without the new file's name the report cannot name its backup (MIG-02), so an ok reply with no file is a failed backup.
  if (typeof body?.file !== 'string' || body.file === '') throw new MigrationBackupError('Dojo took no usable backup before upgrading your data (the server named no file), so it changed nothing.')
  return body.file
}

/** The boot step: the flat migration (and, once migrated, the plain reconcile it runs) against the loaded plan v2. */
export async function bootPlan(d: DojoDB, res: { v2: PlanV2 }, opts: FlatRunOptions = {}): Promise<void> {
  await runFlatMigration(d, res.v2, { backup: backupBeforeMigration, ...opts })
}

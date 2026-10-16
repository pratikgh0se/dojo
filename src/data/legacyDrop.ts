import Dexie from 'dexie'
import { declareV12, SCHEMA_V12, syncGate, type DojoDB } from './db'
import { backupBeforeMigration } from './flatMigration'
import { writerHeaders } from './writer'

/** The three tables Dexie v12 drops (migration.md MIG-31 to MIG-35). */
const LEGACY_TABLES = Object.keys(SCHEMA_V12)

export interface LegacyDropResult {
  /** `declared`: v12 is added and the database may open (it drops the tables); `held`: it stays on v11 until the next launch. */
  status: 'declared' | 'held'
  /** The server's backup file when one was taken for this drop. */
  backupFile: string | null
  reason?: string
}

export interface LegacyDropOptions {
  /** the backup step; defaults to `POST /db/backup` through `fetchImpl` */
  backup?: () => Promise<string | null>
  readOnly?: boolean
  /** disk sync is on (an app with a server); false in the Dexie-only e2e/preview build */
  disk?: boolean
  fetchImpl?: typeof fetch
}

/**
 * What IndexedDB holds for `name`: its Dexie version (null when there is no such database) and how many rows the three legacy tables
 * have in it. Opens it without a schema, so it changes nothing.
 */
export async function probeStored(name: string): Promise<{ version: number | null; legacyRows: number }> {
  const probe = new Dexie(name)
  try {
    await probe.open()
  } catch (e) {
    if ((e as { name?: string }).name === 'NoSuchDatabaseError') return { version: null, legacyRows: 0 }
    throw e
  }
  try {
    let legacyRows = 0
    for (const t of LEGACY_TABLES) if (probe.tables.some(x => x.name === t)) legacyRows += await probe.table(t).count()
    return { version: probe.verno, legacyRows }
  } finally {
    probe.close()
  }
}

/** How many live documents each legacy table holds on the server (`GET /db/state`). Throws when the server cannot be read. */
async function serverLegacyCounts(f: typeof fetch): Promise<Record<string, number>> {
  const res = await f('/db/state', { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const tables = ((await res.json()) as { tables?: Record<string, unknown[]> }).tables ?? {}
  return Object.fromEntries(LEGACY_TABLES.map(t => [t, Array.isArray(tables[t]) ? tables[t].length : 0]))
}

/** Tombstones every live document of the named tables on the server (the existing `clear` op of `POST /db/ops`), so none is left to be read back. */
async function clearOnServer(f: typeof fetch, tables: string[]): Promise<void> {
  const res = await f('/db/ops', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...writerHeaders() },
    body: JSON.stringify({ clientId: 'dojo-v12-drop', ops: tables.map(tbl => ({ opId: `v12-drop-${tbl}`, tbl, op: 'clear' })) }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

/**
 * R2 v12, the boot step before the app database is first opened (R-8). When the stored database is older than v12, or the server still
 * holds documents of the three legacy tables, the server takes its backup FIRST (the same `POST /db/backup` as the flat migration), the
 * documents are then cleared on the server, and only after that is version 12 declared, so the open that follows drops the tables from
 * the browser. If the backup or the clear fails, the database stays on v11 with every row and the step retries on the next launch.
 * A Dexie-only run (no server) and a database already on v12 need no backup. A read-only browser cannot take one and stays on v11.
 * Why not an `upgrade()` hook: it runs inside the version-change transaction, which cannot wait for a fetch.
 */
export async function prepareLegacyDrop(d: DojoDB, opts: LegacyDropOptions = {}): Promise<LegacyDropResult> {
  const held = (reason: string): LegacyDropResult => ({ status: 'held', backupFile: null, reason })
  if (opts.readOnly ?? syncGate.readOnly) return held('read-only browser')
  if (d.isOpen()) return held('database already open')
  const f = opts.fetchImpl ?? ((i: RequestInfo | URL, n?: RequestInit) => globalThis.fetch(i, n))
  const disk = opts.disk ?? import.meta.env.VITE_DOJO_DISK !== 'off'
  const stored = await probeStored(d.name)
  if (!disk || (stored.version !== null && stored.version >= 12)) {
    declareV12(d)
    return { status: 'declared', backupFile: null }
  }
  let onServer: Record<string, number>
  try {
    onServer = await serverLegacyCounts(f)
  } catch (e) {
    return held(`Dojo could not read the server before upgrading your data, so it changed nothing: ${e instanceof Error ? e.message : String(e)}`)
  }
  const present = LEGACY_TABLES.filter(t => onServer[t] > 0)
  let backupFile: string | null = null
  if (present.length > 0 || stored.legacyRows > 0) {
    try {
      backupFile = await (opts.backup ?? (() => backupBeforeMigration(f)))()
      if (present.length > 0) await clearOnServer(f, present)
    } catch (e) {
      return held(e instanceof Error ? e.message : String(e))
    }
  }
  declareV12(d)
  return { status: 'declared', backupFile }
}

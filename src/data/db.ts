import Dexie, { type Table } from 'dexie'
import type {
  AiLogRow, AtlasRun, BankItem, DesignSession, GradeRow, PictureRow,
  BankExtraRow, BankGradeRow, JournalRow, Pulse, Redo, RungUse, Session, Settings, StoredEvent, Ticket, CheckAttemptRow, ReviewRow, CodeRow,
  LabReviewRow, LabRow, LabRunRow, PortfolioItem, WeeklyReviewRow,
} from './types'
import { isReadOnly } from './writer' // first: takes the writer token out of the URL before anything else runs
import { newOpId } from './sync/keys'
import { outboxMiddleware, type SyncGate } from './sync/middleware'

/** One pending change for the disk server (see data/sync). `seq` is the local queue order. */
export interface OutboxRow {
  seq?: number
  opId: string
  tbl: string
  op: 'put' | 'delete' | 'clear'
  id?: string
  doc?: unknown
  /** Append-only tables: a NEW row (an add); the server refuses to overwrite an existing id with it. */
  create?: boolean
  /** Append-only tables: an edit of a row hydrated from disk (maybe another client's; Addendum 2). */
  known?: boolean
  /** Rows of one group are sent in one request (the flat migration is all-or-nothing on disk too). */
  grp?: string
  at: string
}
export interface MetaRow { key: string; value: unknown }

export type SettingsRow = Settings & { id: 'main' }

export type DojoDB = Dexie & {
  tickets: Table<Ticket, string>
  sessions: Table<Session, string>
  events: Table<StoredEvent, number>
  settings: Table<SettingsRow, string>
  rungUses: Table<RungUse, string>
  redos: Table<Redo, string>
  aiLog: Table<AiLogRow, number>
  pictures: Table<PictureRow, string>
  atlasRuns: Table<AtlasRun, number>
  designSessions: Table<DesignSession, string>
  grades: Table<GradeRow, string>
  bankItems: Table<BankItem, string>
  checkAttempts: Table<CheckAttemptRow, string>
  reviews: Table<ReviewRow, string>
  code: Table<CodeRow, [string, string]>
  pulses: Table<Pulse, string>
  journal: Table<JournalRow, string>
  bankGrades: Table<BankGradeRow, string>
  bankExtra: Table<BankExtraRow, string>
  labs: Table<LabRow, string>
  labRuns: Table<LabRunRow, string>
  labReviews: Table<LabReviewRow, string>
  weeklyReviews: Table<WeeklyReviewRow, string>
  portfolioItems: Table<PortfolioItem, string>
  _outbox: Table<OutboxRow, number>
  _meta: Table<MetaRow, string>
}

export const DB_NAME = 'dojo'
export const DB_VERSION = 12

/** Milestone-1 schema. Never edit: existing browsers hold data at this version. */
export const SCHEMA_V1 = {
  tickets: 'id, sprint, status, track, kind',
  sessions: 'id, ticketId, start',
  events: '++seq, t, id, at',
  settings: 'id',
} as const

/**
 * The one foundation bump (spec §2). Every new field on an existing row is optional, so no
 * upgrade() is needed; Dexie builds the new `origin` index over existing tickets on open.
 * Chains add rules and UI on top of these tables and never change this schema.
 */
export const SCHEMA_V2 = {
  ...SCHEMA_V1,
  tickets: 'id, sprint, status, track, kind, origin',
  rungUses: 'id, ticketId, attemptStart, at',
  redos: 'id, ticketId, due, stage',
  aiLog: '++seq, job, at, ticketId',
  pictures: 'key, source, createdAt',
  atlasRuns: '++seq, key, kind, at',
  designSessions: 'id, designId, at, redesignDue',
  artifacts: 'id, status, block, stage',
  stageCells: 'id, stage, cell',
  blankTests: 'id, stage, at',
  grades: 'id, targetId, at',
  bankItems: 'id, bank, pattern, status, ticketId',
} as const

/**
 * v3 (Dojo v2 storage): only ADDS the sync bookkeeping tables. `_outbox` queues changes for the
 * disk server; `_meta` keeps the client id. App tables are untouched, so no upgrade() is needed.
 */
export const SCHEMA_V3 = {
  ...SCHEMA_V2,
  _outbox: '++seq',
  _meta: 'key',
} as const

/**
 * v4 (Dojo v2 part 3): only ADDS the learning-check attempts and the sprint reviews tables. No app table
 * changes, so no upgrade() is needed (briefs, pins and roll-overs are optional fields on tickets).
 */
export const SCHEMA_V4 = {
  ...SCHEMA_V3,
  checkAttempts: 'id, ticketId, at',
  reviews: 'id, sprint, at',
} as const

/**
 * v5 (Dojo v2 part 4a, C-RUNNER §4): only ADDS the runner's `code` table, one row per ticket keyed by
 * ticketId. No app table changes, so no upgrade() is needed.
 */
export const SCHEMA_V5 = {
  ...SCHEMA_V4,
  code: 'ticketId',
} as const

/**
 * v6 + v7 (Dojo v2 part 4b, C-PYTHON §4): `code` becomes one row per (ticket, language), keyed
 * `[ticketId+lang]`. Dexie cannot change a primary key in place, so v6 moves the rows into the
 * sync-invisible table `_codeTmp` (underscore tables are never queued) while `code` is dropped, and v7
 * recreates `code` with the compound key and moves the rows back. Existing Go rows survive unchanged.
 */
export const SCHEMA_V6 = {
  ...SCHEMA_V5,
  code: null,
  _codeTmp: '[ticketId+lang]',
} as const
export const SCHEMA_V7 = {
  ...SCHEMA_V5,
  code: '[ticketId+lang]',
} as const

/**
 * v8 (R1 F1, Today ritual column): only ADDS `pulses`, the daily AI pulse log (one row per local day, `pulse-YYYY-MM-DD`).
 * No existing table changes and the upgrade writes nothing, so a v7 browser opens with an empty `pulses`.
 */
export const SCHEMA_V8 = {
  ...SCHEMA_V7,
  pulses: 'id, day',
} as const

/**
 * v9 (R1 scope 2 W2, the daily journal): only ADDS `journal`, one row per local day (`journal-YYYY-MM-DD`). No existing table
 * changes and the upgrade writes nothing, so a v8 browser opens with an empty `journal`.
 */
export const SCHEMA_V9 = {
  ...SCHEMA_V8,
  journal: 'id, day',
} as const

/**
 * v10 (R1 scope 2 W6, question banks): only ADDS `bankGrades` (one row per graded question, keyed by the question id) and `bankExtra`
 * (AI-made questions). No existing table changes and the upgrade writes nothing, so a v8 or v9 browser opens with both tables empty.
 */
export const SCHEMA_V10 = {
  ...SCHEMA_V9,
  bankGrades: 'id, area, node',
  bankExtra: 'id, area, node',
} as const

/**
 * v11 (R2): ADDS every new table of the release at once, so the early lab drop installs the final schema for new data and v12
 * (W7) only removes old tables. `labs` (a set-up lab, keyed by labId), `labRuns` and `labReviews` (W1/W2), `weeklyReviews` (W5)
 * and `portfolioItems` (W6). No existing table changes and the upgrade writes nothing, so a v10 browser opens with all five empty.
 */
export const SCHEMA_V11 = {
  ...SCHEMA_V10,
  labs: 'labId',
  labRuns: 'id, labId, at',
  labReviews: 'id, labId, at',
  weeklyReviews: 'id',
  portfolioItems: 'id, labId',
} as const

/**
 * v12 (R2 W7): drops `artifacts`, `stageCells` and `blankTests`, the tables of the retired capstone track. Their rows are history, so
 * a backup comes first (data/legacyDrop.ts): the app database is created holding this version back and declares it only after the
 * backup succeeded. A table set to null is deleted when the database upgrades; nothing else changes.
 */
export const SCHEMA_V12 = { artifacts: null, stageCells: null, blankTests: null } as const
/** Adds v12 to a database that has not been opened yet (Dexie refuses a new version once it is open). */
export function declareV12(d: DojoDB): void {
  d.version(12).stores(SCHEMA_V12)
}

export const DEFAULT_SETTINGS: SettingsRow = {
  id: 'main',
  startDate: '',
  planVersion: '',
  aiProviders: {},
  possibleXp: 0,
}

/**
 * With a gate, the disk-sync outbox middleware is installed before the database can be opened. `holdV12` stops at v11: the app
 * database is created that way and declares v12 only after its backup (data/legacyDrop.ts); every other caller gets v12 at once.
 */
export function createDb(name: string = DB_NAME, gate?: SyncGate, opts: { holdV12?: boolean } = {}): DojoDB {
  const d = new Dexie(name) as DojoDB
  d.version(1).stores(SCHEMA_V1)
  d.version(2).stores(SCHEMA_V2)
  d.version(3).stores(SCHEMA_V3)
  d.version(4).stores(SCHEMA_V4)
  d.version(5).stores(SCHEMA_V5)
  d.version(6).stores(SCHEMA_V6).upgrade(async tx => {
    const rows = await tx.table('code').toArray()
    if (rows.length) await tx.table('_codeTmp').bulkPut(rows.map(r => ({ ...r, lang: r.lang ?? 'go' })))
  })
  d.version(7).stores({ ...SCHEMA_V7, _codeTmp: null }).upgrade(async tx => {
    const rows = (await tx.table('_codeTmp').toArray()) as CodeRow[]
    if (!rows.length) return
    // The upgrade must not be refused (a read-only browser) or queued by the outbox middleware: the
    // rows are written under bypass, and what the disk needs is queued by hand below.
    const was = gate?.bypass
    if (gate) gate.bypass = true
    try {
      await tx.table('code').bulkPut(rows)
    } finally {
      if (gate) gate.bypass = was ?? false
    }
    if (gate && !gate.readOnly) {
      // Disk docs of 4a are keyed by ticketId alone: write the new ids, then retire the old ones.
      const at = new Date().toISOString()
      const op = (o: Omit<OutboxRow, 'opId' | 'at'>): OutboxRow => ({ opId: newOpId(), at, ...o })
      await tx.table('_outbox').bulkAdd([
        ...rows.map(r => op({ tbl: 'code', op: 'put', id: `${r.ticketId}:${r.lang}`, doc: r })),
        ...rows.filter(r => r.lang === 'go').map(r => op({ tbl: 'code', op: 'delete', id: r.ticketId })),
      ])
    }
  })
  d.version(8).stores({ pulses: SCHEMA_V8.pulses })
  d.version(9).stores({ journal: SCHEMA_V9.journal })
  d.version(10).stores({ bankGrades: SCHEMA_V10.bankGrades, bankExtra: SCHEMA_V10.bankExtra })
  d.version(11).stores({
    labs: SCHEMA_V11.labs, labRuns: SCHEMA_V11.labRuns, labReviews: SCHEMA_V11.labReviews,
    weeklyReviews: SCHEMA_V11.weeklyReviews, portfolioItems: SCHEMA_V11.portfolioItems,
  })
  if (!opts.holdV12) declareV12(d)
  if (gate) d.use(outboxMiddleware(gate))
  return d
}

/**
 * I8: the app database queues every write in _outbox from the very first one, whether or not the
 * lazily loaded sync code (data/sync/boot) ever runs. VITE_DOJO_DISK=off (Dexie-only e2e runs) skips it.
 */
export const syncGate: SyncGate = { bypass: false, readOnly: isReadOnly() }
/**
 * Addendum 3 (fresh start): with disk sync on, the writer keeps its working copy in its own database
 * (dojo-disk), created by this version with the outbox recorder installed, and a read-only browser its
 * view of the disk in another (dojo-view). Neither ever opens an older 'dojo' database, whose data is
 * neither imported nor touched. VITE_DOJO_DISK=off (Dexie only) keeps using 'dojo'.
 */
export const WRITER_DB_NAME = 'dojo-disk'
export const READ_ONLY_DB_NAME = 'dojo-view'
const diskOn = import.meta.env.VITE_DOJO_DISK !== 'off'
// held at v11 until `prepareLegacyDrop` (the first thing `main.tsx` boots) has taken the backup and declared v12
export const db: DojoDB = createDb(!diskOn ? DB_NAME : syncGate.readOnly ? READ_ONLY_DB_NAME : WRITER_DB_NAME, diskOn ? syncGate : undefined, { holdV12: true })

export async function getSettings(d: DojoDB): Promise<SettingsRow> {
  const row = await d.settings.get('main')
  return { ...DEFAULT_SETTINGS, aiProviders: {}, ...(row ?? {}) }
}

export async function patchSettings(d: DojoDB, patch: Partial<Settings>): Promise<SettingsRow> {
  return d.transaction('rw', d.settings, async () => {
    const next: SettingsRow = { ...(await getSettings(d)), ...patch, id: 'main' }
    await d.settings.put(next)
    return next
  })
}

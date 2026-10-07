// The storage seam. SqliteAdapter wraps node:sqlite's DatabaseSync; a PostgresAdapter can be added
// later behind the same small interface: exec(sql), all(sql, ...params), get(sql, ...params),
// run(sql, ...params), transaction(fn), backupTo(file), close().
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Loaded via getBuiltinModule so bundlers/test runners that strip the `node:` prefix (vitest 2 does
// for the newer built-in `sqlite`) still resolve it.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite')

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations')

export class SqliteAdapter {
  constructor(path, { readOnly = false } = {}) {
    this.path = path
    if (path !== ':memory:' && !readOnly) mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path, { readOnly })
    if (!readOnly) this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;')
  }

  exec(sql) {
    this.db.exec(sql)
  }

  all(sql, ...params) {
    return this.db.prepare(sql).all(...params)
  }

  get(sql, ...params) {
    return this.db.prepare(sql).get(...params)
  }

  run(sql, ...params) {
    return this.db.prepare(sql).run(...params)
  }

  /** Runs fn inside BEGIN IMMEDIATE / COMMIT; rolls back and rethrows on error. */
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn(this)
      this.db.exec('COMMIT')
      return out
    } catch (e) {
      try { this.db.exec('ROLLBACK') } catch { /* already rolled back */ }
      throw e
    }
  }

  /** Consistent snapshot into a new file (the file must not exist). */
  backupTo(file) {
    this.db.prepare('VACUUM INTO ?').run(file)
  }

  close() {
    this.db.close()
  }
}

export function openSqlite(path, opts) {
  return new SqliteAdapter(path, opts)
}

/** Applies every NNN_name.sql in dir that is not yet recorded. Safe to run repeatedly. */
export function runMigrations(adapter, dir = MIGRATIONS_DIR, now = () => new Date().toISOString()) {
  adapter.exec('CREATE TABLE IF NOT EXISTS dojo_schema_migrations (version text NOT NULL PRIMARY KEY, applied_at text NOT NULL)')
  const applied = new Set(adapter.all('SELECT version FROM dojo_schema_migrations').map(r => r.version))
  const ran = []
  for (const file of readdirSync(dir).filter(f => /^\d+_.+\.sql$/.test(f)).sort()) {
    const version = file.replace(/\.sql$/, '')
    if (applied.has(version)) continue
    const sql = readFileSync(join(dir, file), 'utf8')
    adapter.transaction(a => {
      a.exec(sql)
      a.run('INSERT INTO dojo_schema_migrations (version, applied_at) VALUES (?, ?)', version, now())
    })
    ran.push(version)
  }
  ensureDbId(adapter)
  return ran
}

/** The database identity (dojo_meta 'db_id'): created once; `rotate` gives a restored file a new one. */
export function ensureDbId(adapter, { rotate = false } = {}) {
  if (rotate) {
    adapter.run(`INSERT INTO dojo_meta (key, value) VALUES ('db_id', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, randomUUID())
  } else {
    adapter.run(`INSERT INTO dojo_meta (key, value) VALUES ('db_id', ?) ON CONFLICT (key) DO NOTHING`, randomUUID())
  }
  return adapter.get(`SELECT value FROM dojo_meta WHERE key = 'db_id'`).value
}

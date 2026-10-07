#!/usr/bin/env node
// `npm run db:export-pg`: dumps DOJO_HOME/dojo.db as Postgres SQL into DOJO_HOME/export/dojo-pg-<ts>.sql:
// CREATE SCHEMA dojo, the migrations (doc columns as jsonb), INSERTs for every row, and a row-count
// check as a trailing comment. No pg dependency; a future PostgresAdapter sits behind server/db/adapter.mjs.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIGRATIONS_DIR, openSqlite } from '../server/db/adapter.mjs'

const lit = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)

/** The migrations as Postgres DDL: same SQL, JSON text columns become jsonb. */
export function pgMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir).filter(f => /^\d+_.+\.sql$/.test(f)).sort()
    .map(f => `-- ${f}\n${readFileSync(join(dir, f), 'utf8').replace(/\bdoc text\b/g, 'doc jsonb').trim()}\n`)
    .join('\n')
}

/** Removes NUL characters from every string (and key) of a JSON text; null when there were none. */
function stripNul(text) {
  if (typeof text !== 'string' || !text.includes('\\u0000')) return null
  let hit = false
  const clean = v => {
    if (typeof v === 'string') { if (v.includes('\u0000')) { hit = true; return v.replaceAll('\u0000', '') } return v }
    if (Array.isArray(v)) return v.map(clean)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [clean(k), clean(x)]))
    return v
  }
  let parsed
  try { parsed = JSON.parse(text) } catch { return null }
  const out = JSON.stringify(clean(parsed))
  return hit ? out : null
}

export function buildDump(adapter, now = () => new Date().toISOString()) {
  const out = []
  const warnings = []
  // Postgres: backslashes in '...' literals are literal (the dump never emits E'' strings).
  out.push(`-- Dojo export for Postgres, ${now()}`, 'SET standard_conforming_strings = on;', 'CREATE SCHEMA IF NOT EXISTS dojo;', 'SET search_path TO dojo;', 'BEGIN;', '', pgMigrations(), '')
  const counts = {}
  const dump = (table, cols, order, key) => {
    const rows = adapter.all(`SELECT ${cols.join(', ')} FROM ${table} ORDER BY ${order}`)
    counts[table] = rows.length
    for (const r of rows) {
      if ('doc' in r) {
        // jsonb cannot hold \u0000; drop the NUL characters rather than fail the whole load.
        const clean = stripNul(r.doc)
        if (clean !== null) {
          warnings.push(`removed NUL characters from ${table} ${key(r)}`)
          r.doc = clean
        }
      }
      const conflict = table === 'dojo_schema_migrations' ? ' ON CONFLICT (version) DO NOTHING' : table === 'dojo_meta' ? ' ON CONFLICT (key) DO NOTHING' : ''
      // Addendum 6: schema-qualified, one INSERT per line.
      out.push(`INSERT INTO dojo.${table} (${cols.join(', ')}) VALUES (${cols.map(c => lit(r[c])).join(', ')})${conflict};`)
    }
  }
  // One read transaction: every table comes from the same snapshot even if the server is writing.
  adapter.exec('BEGIN')
  try {
    dump('dojo_schema_migrations', ['version', 'applied_at'], 'version', r => r.version)
    dump('dojo_meta', ['key', 'value'], 'key', r => r.key)
    dump('dojo_docs', ['tbl', 'id', 'doc', 'updated_at', 'deleted'], 'tbl, id', r => `${r.tbl}/${r.id}`)
    dump('dojo_ops', ['seq', 'at', 'client_id', 'tbl', 'op', 'id', 'doc', 'op_id'], 'seq', r => `seq ${r.seq} (${r.tbl}/${r.id})`)
  } finally {
    adapter.exec('COMMIT')
  }
  out.push('', 'COMMIT;', '', `-- Row counts to verify after loading: ${Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(', ')}`)
  out.push(`-- SELECT ${Object.keys(counts).map(t => `(SELECT count(*) FROM ${t}) AS ${t}`).join(', ')};`)
  return { sql: out.join('\n') + '\n', counts, warnings }
}

export function exportPg({ home, now = () => new Date() }) {
  const db = openSqlite(join(home, 'dojo.db'), { readOnly: true })
  try {
    const { sql, counts, warnings } = buildDump(db, () => now().toISOString())
    const dir = join(home, 'export')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `dojo-pg-${now().toISOString().replace(/[:.]/g, '-')}.sql`)
    writeFileSync(file, sql)
    return { file, counts, warnings }
  } finally {
    db.close()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const home = process.env.DOJO_HOME || join(homedir(), 'Dojo')
  const { file, counts, warnings } = exportPg({ home })
  for (const w of warnings) console.warn(`warning: ${w}`)
  console.log(`wrote ${file}`)
  console.log(Object.entries(counts).map(([t, n]) => `${t}: ${n}`).join('\n'))
}

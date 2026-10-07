// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openSqlite } from '../../server/db/adapter.mjs'
import { openDojo, type Dojo } from '../../server/db/manager.mjs'
import { buildDump, exportPg, pgMigrations } from '../../scripts/export-pg.mjs'

let home: string
let d: Dojo
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dojo-export-'))
  d = openDojo({ home })
  d.store.applyOps({ clientId: 'c', ops: [
    { tbl: 'tickets', op: 'put', id: 'p127', doc: { id: 'p127', status: 'done', title: "it's \"quoted\" \\ back" }, at: '2026-09-29T00:00:00.000Z', opId: 'o1' },
    { tbl: 'tickets', op: 'put', id: 'p128', doc: { id: 'p128' }, at: 'x' },
    { tbl: 'tickets', op: 'delete', id: 'p128', at: 'y' },
  ] })
})
afterEach(() => {
  d.close()
  rmSync(home, { recursive: true, force: true })
})

describe('db:export-pg', () => {
  it('writes DOJO_HOME/export/dojo-pg-<ts>.sql with schema, jsonb, inserts and counts', () => {
    const { file, counts } = exportPg({ home })
    expect(file.startsWith(join(home, 'export', 'dojo-pg-'))).toBe(true)
    const sql = readFileSync(file, 'utf8')
    expect(sql).toContain('CREATE SCHEMA IF NOT EXISTS dojo;')
    expect(sql).toMatch(/doc jsonb NOT NULL/)
    expect(sql).not.toMatch(/doc text/)
    expect(sql).toContain("INSERT INTO dojo.dojo_docs (tbl, id, doc, updated_at, deleted) VALUES ('tickets', 'p127'")
    expect(sql).toContain("it''s")
    expect(counts).toEqual({ dojo_schema_migrations: 3, dojo_meta: 1, dojo_docs: 2, dojo_ops: 3 })
    expect(sql).toContain('-- Row counts to verify after loading: dojo_schema_migrations=3, dojo_meta=1, dojo_docs=2, dojo_ops=3')
  })

  it('the dump is well formed: loading it into an empty database reproduces the rows', () => {
    const sql = readFileSync(exportPg({ home }).file, 'utf8')
    const copy = openSqlite(':memory:')
    // SQLite has no schemas; everything else in the dump is portable SQL.
    copy.exec(sql.replace(/INSERT INTO dojo\./g, 'INSERT INTO ').replace('SET standard_conforming_strings = on;', '').replace('CREATE SCHEMA IF NOT EXISTS dojo;', '').replace('SET search_path TO dojo;', '').replace(/BEGIN;|COMMIT;/g, ''))
    expect(copy.get('SELECT count(*) AS n FROM dojo_docs')?.n).toBe(2)
    expect(copy.get('SELECT count(*) AS n FROM dojo_ops')?.n).toBe(3)
    expect(JSON.parse(copy.get("SELECT doc FROM dojo_docs WHERE id='p127'")?.doc).title).toBe("it's \"quoted\" \\ back")
    expect(copy.get("SELECT deleted FROM dojo_docs WHERE id='p128'")?.deleted).toBe(1)
    expect(copy.get("SELECT op_id FROM dojo_ops WHERE seq = 2")?.op_id).toBeNull()
    copy.close()
  })

  it('migrations convert only doc columns', () => {
    expect(pgMigrations()).toContain('doc jsonb')
  })

  it('does not modify the database', () => {
    const before = d.health().ops
    exportPg({ home })
    expect(d.health().ops).toBe(before)
  })
})

describe('db:export-pg safety', () => {
  it('turns standard_conforming_strings on before any literal', () => {
    const sql = readFileSync(exportPg({ home }).file, 'utf8')
    expect(sql.indexOf('SET standard_conforming_strings = on;')).toBeGreaterThan(-1)
    expect(sql.indexOf('SET standard_conforming_strings = on;')).toBeLessThan(sql.indexOf('INSERT'))
  })

  it('reads every table inside one transaction', () => {
    const a = openSqlite(join(home, 'dojo.db'), { readOnly: true })
    const calls: string[] = []
    const spy = new Proxy(a, { get: (t, k) => {
      const v = Reflect.get(t, k)
      return typeof v === 'function' ? (...args: unknown[]) => { calls.push(k === 'exec' ? String(args[0]) : String(k)); return v.apply(t, args) } : v
    } })
    buildDump(spy)
    a.close()
    expect(calls[0]).toBe('BEGIN')
    expect(calls.at(-1)).toBe('COMMIT')
    expect(calls.filter(c => c === 'all').length).toBeGreaterThanOrEqual(4)
  })

  it('strips NUL characters (jsonb rejects \\u0000) and warns', () => {
    d.store.applyOps({ clientId: 'c', ops: [{ tbl: 'notes', op: 'put', id: 'n1', doc: { id: 'n1', text: 'a\u0000b' }, at: 'x' }] })
    const r = exportPg({ home })
    const sql = readFileSync(r.file, 'utf8')
    expect(sql).not.toContain('\\u0000')
    expect(sql).toContain('"text":"ab"')
    expect(r.warnings.join('\n')).toMatch(/NUL.*notes\/n1/)
  })
})

describe('Addendum 6: export lines', () => {
  it('one schema-qualified INSERT per line; the ticked ticket carries "status":"done"', () => {
    const sql = readFileSync(exportPg({ home }).file, 'utf8')
    const line = sql.split('\n').find(l => l.startsWith("INSERT INTO dojo.dojo_docs (tbl, id, doc, updated_at, deleted) VALUES ('tickets', 'p127'"))
    expect(line).toBeTruthy()
    expect(line).toContain('"status":"done"')
    expect(line!.endsWith(');')).toBe(true)
    expect(sql).not.toMatch(/^INSERT INTO dojo_/m)
  })
})

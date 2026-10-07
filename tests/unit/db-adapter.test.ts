// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { openSqlite, runMigrations } from '../../server/db/adapter.mjs'

describe('migrations', () => {
  it('create the dojo_ tables and running twice is harmless', () => {
    const a = openSqlite(':memory:')
    expect(runMigrations(a)).toEqual(['001_init', '002_ops_doc_index', '003_meta'])
    expect(runMigrations(a)).toEqual([])
    const names = a.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").map(r => r.name)
    expect(names).toEqual(expect.arrayContaining(['dojo_docs', 'dojo_meta', 'dojo_ops', 'dojo_schema_migrations']))
    expect(a.get('SELECT count(*) AS n FROM dojo_schema_migrations')?.n).toBe(3)
    a.close()
  })

  it('transaction rolls back on error', () => {
    const a = openSqlite(':memory:')
    runMigrations(a)
    expect(() => a.transaction(t => {
      t.run("INSERT INTO dojo_docs (tbl,id,doc,updated_at) VALUES ('x','1','{}','t')")
      throw new Error('boom')
    })).toThrow('boom')
    expect(a.get('SELECT count(*) AS n FROM dojo_docs')?.n).toBe(0)
    a.close()
  })

  it('only uses portable SQL in migrations', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const { MIGRATIONS_DIR } = await import('../../server/db/adapter.mjs')
    for (const f of readdirSync(MIGRATIONS_DIR)) {
      expect(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8')).not.toMatch(/AUTOINCREMENT|WITHOUT ROWID/i)
    }
  })
})

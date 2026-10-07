// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { openSqlite } from '../../server/db/adapter.mjs'

// G4 #2: kill the server process at the swap and check what dojo.db holds afterwards.
let home: string
afterEach(() => rmSync(home, { recursive: true, force: true }))
const manager = pathToFileURL(join(process.cwd(), 'server/db/manager.mjs')).href

function runUntilKilled(killAt: 'beforeSwap' | 'afterSwap') {
  home = mkdtempSync(join(tmpdir(), 'dojo-kill-'))
  const script = `
    const { openDojo } = await import(${JSON.stringify(manager)})
    const put = id => ({ clientId: 'c', ops: [{ tbl: 'tickets', op: 'put', id, doc: { id }, at: 'x' }] })
    const d = openDojo({ home: ${JSON.stringify(home)}, hooks: { ${killAt}: () => process.kill(process.pid, 'SIGKILL') } })
    d.store.applyOps(put('A'))
    d.backup()
    d.store.applyOps(put('B'))
    process.stdout.write(JSON.stringify({ dbId: d.health().dbId, ops: d.health().ops }) + '\\n')
    d.restore(d.listBackups()[0].file)
  `
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
  expect(r.signal).toBe('SIGKILL')
  return JSON.parse(r.stdout.trim().split('\n')[0]) as { dbId: string; ops: number }
}
function onDisk() {
  const a = openSqlite(join(home, 'dojo.db'))
  try {
    return {
      check: a.all('PRAGMA quick_check').map(r => Object.values(r)[0]),
      ids: a.all('SELECT id FROM dojo_docs WHERE deleted = 0 ORDER BY id').map(r => r.id),
      ops: Number(a.get('SELECT COUNT(*) AS n FROM dojo_ops')?.n),
      restoreOps: Number(a.get("SELECT COUNT(*) AS n FROM dojo_ops WHERE op = 'restore'")?.n),
      dbId: a.get("SELECT value FROM dojo_meta WHERE key = 'db_id'")?.value,
    }
  } finally {
    a.close()
  }
}

describe('G4 #2: a crash at any point of a restore leaves a complete database', () => {
  it('killed just before the rename: the live database is untouched', () => {
    const before = runUntilKilled('beforeSwap')
    const db = onDisk()
    expect(db.check).toEqual(['ok'])
    expect(db.ids).toEqual(['A', 'B'])
    expect(db.dbId).toBe(before.dbId)
    expect(db.ops).toBe(before.ops)
  })

  it('killed just after the rename: the restored database already has all history and a new id', () => {
    const before = runUntilKilled('afterSwap')
    const db = onDisk()
    expect(db.check).toEqual(['ok'])
    expect(db.ids).toEqual(['A'])
    expect(db.ops).toBeGreaterThanOrEqual(before.ops + 1)
    expect(db.restoreOps).toBe(1)
    expect(db.dbId).not.toBe(before.dbId)
  })
})

// @vitest-environment node
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KEEP_DATED_BACKUPS, openDojo, type Dojo } from '../../server/db/manager.mjs'

let home: string
let d: Dojo
let day = new Date(2026, 8, 29, 10, 0, 0)
const put = (id: string) => ({ clientId: 'c', ops: [{ tbl: 'tickets', op: 'put', id, doc: { id }, at: 'x' }] })

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'dojo-test-'))
  day = new Date(2026, 8, 29, 10, 0, 0)
  d = openDojo({ home, clock: () => day })
})
afterEach(() => {
  d.close()
  rmSync(home, { recursive: true, force: true })
})

describe('backups', () => {
  it('writes a dated snapshot on start only if today is missing', () => {
    expect(d.ensureTodaysBackup()?.file).toBe('dojo-2026-09-29.db')
    expect(d.ensureTodaysBackup()).toBeNull()
    expect(d.listBackups().map(b => b.file)).toEqual(['dojo-2026-09-29.db'])
    expect(d.listBackups()[0].bytes).toBeGreaterThan(0)
  })

  it('UAT r3 J8: a daily snapshot is listed at the time it was taken (its mtime on that day), not 00:00', () => {
    d.ensureTodaysBackup()
    const f = join(home, 'backups', 'dojo-2026-09-29.db')
    const taken = new Date(2026, 8, 29, 19, 53, 0)
    utimesSync(f, taken, taken)
    expect(d.listBackups()[0].at).toBe(taken.toISOString())
    const elsewhere = new Date(2026, 9, 2, 8, 0, 0) // copied in later: the name's day wins
    utimesSync(f, elsewhere, elsewhere)
    expect(d.listBackups()[0].at).toBe(new Date(2026, 8, 29, 0, 0, 0).toISOString())
  })

  it('keeps the newest 30 dated snapshots and never prunes pre-restore files', () => {
    writeFileSync(join(home, 'backups', 'pre-restore-old.db'), 'x')
    for (let i = 0; i < 35; i++) {
      day = new Date(2026, 0, 1 + i, 10)
      d.backup()
    }
    const files = readdirSync(join(home, 'backups'))
    const dated = files.filter(f => f.startsWith('dojo-')).sort()
    expect(dated).toHaveLength(KEEP_DATED_BACKUPS)
    expect(dated[0]).toBe('dojo-2026-01-06.db')
    expect(files).toContain('pre-restore-old.db')
  })

  it('restore snapshots the current db first, swaps the file in and reopens', () => {
    d.store.applyOps(put('A'))
    d.backup()
    d.store.applyOps(put('B'))
    day = new Date(2026, 8, 29, 11)
    const r = d.restore('dojo-2026-09-29.db')
    expect(r.preRestore).toMatch(/^pre-restore-.*\.db$/)
    expect(existsSync(join(home, 'backups', r.preRestore))).toBe(true)
    expect((d.store.state().tables.tickets as { id: string }[]).map(x => x.id)).toEqual(['A'])
    expect(d.listBackups().some(b => b.file === r.preRestore)).toBe(true)
    d.store.applyOps(put('C'))
    expect(d.store.health().docs).toBe(2)
  })

  it('C2: a restore gives the database a new dbId, so browsers synced to the old one re-adopt', () => {
    const before = d.health().dbId
    expect(before).toBeTruthy()
    d.backup()
    d.restore('dojo-2026-09-29.db')
    expect(d.health().dbId).toBeTruthy()
    expect(d.health().dbId).not.toBe(before)
  })

  it('refuses path traversal, unknown and non-Dojo files', () => {
    expect(() => d.restore('../dojo.db')).toThrow(/unknown backup/)
    expect(() => d.restore('dojo-2026-01-01.db')).toThrow(/no backup/)
    writeFileSync(join(home, 'backups', 'dojo-2026-01-02.db'), 'not sqlite')
    expect(() => d.restore('dojo-2026-01-02.db')).toThrow()
    d.store.applyOps(put('A'))
    expect(d.store.health().docs).toBe(1)
  })

  it('Back up now makes a new timestamped file each time and caps manual files at 30', () => {
    d.ensureTodaysBackup()
    const names = new Set<string>()
    for (let i = 0; i < 33; i++) {
      day = new Date(2026, 8, 29, 12, 0, i)
      names.add(d.backupNow().file)
    }
    expect(names.size).toBe(33)
    expect([...names][0]).toBe('dojo-2026-09-29-120000.db')
    const files = readdirSync(join(home, 'backups'))
    expect(files.filter(f => /-\d{6}\.db$/.test(f))).toHaveLength(30)
    expect(files).toContain('dojo-2026-09-29.db')
  })

  it('lists newest first', () => {
    d.backup()
    writeFileSync(join(home, 'backups', 'pre-restore-z.db'), 'x')
    utimesSync(join(home, 'backups', 'pre-restore-z.db'), new Date(2000, 0, 1), new Date(2000, 0, 1))
    expect(d.listBackups().map(b => b.file)).toEqual(['dojo-2026-09-29.db', 'pre-restore-z.db'])
  })
})

describe('I4: restore is atomic', () => {
  const ids = () => ((d.store.state().tables.tickets ?? []) as { id: string }[]).map(x => x.id)
  const reopen = (hooks: Record<string, () => void>) => {
    d.close()
    d = openDojo({ home, clock: () => day, hooks })
  }

  it('a failure before the swap leaves the live database open and unchanged, with no temp file', () => {
    d.store.applyOps(put('A'))
    d.backup()
    d.store.applyOps(put('B'))
    reopen({ beforeSwap: () => { throw new Error('disk full') } })
    expect(() => d.restore('dojo-2026-09-29.db')).toThrow('disk full')
    expect(ids()).toEqual(['A', 'B'])
    d.store.applyOps(put('C')) // still writable
    expect(ids()).toEqual(['A', 'B', 'C'])
    expect(readdirSync(home).filter(f => f.startsWith('.tmp-'))).toEqual([])
  })

  it('a failure after the swap puts the old contents back and reopens them', () => {
    d.store.applyOps(put('A'))
    d.backup()
    d.store.applyOps(put('B'))
    reopen({ afterSwap: () => { throw new Error('reopen failed') } })
    expect(() => d.restore('dojo-2026-09-29.db')).toThrow('reopen failed')
    expect(ids()).toEqual(['A', 'B'])
    d.store.applyOps(put('C'))
    expect(ids()).toEqual(['A', 'B', 'C'])
  })

  it('probes backups read-only with quick_check: a damaged file is a 400 and the backup is not modified', () => {
    d.store.applyOps(put('A'))
    d.backup()
    const good = join(home, 'backups', 'dojo-2026-09-29.db')
    const bad = join(home, 'backups', 'dojo-2026-01-03.db')
    copyFileSync(good, bad)
    const buf = readFileSync(bad)
    buf.fill(0xab, 4096, Math.min(buf.length, 4096 * 3)) // wreck pages after the header
    writeFileSync(bad, buf)
    const before = statSync(bad).mtimeMs
    expect(() => d.restore('dojo-2026-01-03.db')).toThrowError(expect.objectContaining({ status: 400 }))
    expect(statSync(bad).mtimeMs).toBe(before)
    expect(readdirSync(join(home, 'backups')).filter(f => /-(wal|shm|journal)$/.test(f))).toEqual([])
    expect(ids()).toEqual(['A'])
  })

  it('a successful restore leaves no temp file and no stale -wal/-shm from the old database', () => {
    d.store.applyOps(put('A'))
    d.backup()
    d.store.applyOps(put('B'))
    d.restore('dojo-2026-09-29.db')
    expect(ids()).toEqual(['A'])
    expect(readdirSync(home).filter(f => f.startsWith('.tmp-'))).toEqual([])
  })
})

describe('backup housekeeping', () => {
  it('removes leftover .tmp-* files (a crashed backup or restore) on start', () => {
    d.close()
    writeFileSync(join(home, 'backups', '.tmp-123.db'), 'x')
    writeFileSync(join(home, '.tmp-restore-9-1.db'), 'x')
    d = openDojo({ home, clock: () => day })
    expect(readdirSync(join(home, 'backups')).filter(f => f.startsWith('.tmp-'))).toEqual([])
    expect(readdirSync(home).filter(f => f.startsWith('.tmp-'))).toEqual([])
  })

  it('two Back up now in the same second never overwrite each other', () => {
    day = new Date(2026, 8, 29, 12, 0, 0)
    const a = d.backupNow().file
    const b = d.backupNow().file
    const c = d.backupNow().file
    expect(new Set([a, b, c]).size).toBe(3)
    for (const f of [a, b, c]) expect(f).toMatch(/^dojo-\d{4}-\d{2}-\d{2}-\d{6}\.db$/)
    expect(readdirSync(join(home, 'backups')).filter(f => /-\d{6}\.db$/.test(f))).toHaveLength(3)
  })

  it('lastBackup ignores pre-restore files', () => {
    d.backup()
    utimesSync(join(home, 'backups', 'dojo-2026-09-29.db'), new Date(2026, 0, 1), new Date(2026, 0, 1))
    writeFileSync(join(home, 'backups', 'pre-restore-new.db'), 'x')
    expect(d.health().lastBackup).toBe(new Date(2026, 8, 29).toISOString()) // from the name (Addendum 9), not the mtime
  })
})


describe('Addendum 5: a restore brings back the state, never removes history', () => {
  it('ops after a restore >= ops before, and every op seq recorded before is still there', () => {
    d.store.applyOps(put('A'))
    d.backup()
    d.store.applyOps(put('B'))
    d.store.applyOps(put('C'))
    const before = d.health().ops
    const seqs = d.adapter.all('SELECT seq FROM dojo_ops ORDER BY seq').map(r => Number(r.seq))
    d.restore('dojo-2026-09-29.db')
    expect(((d.store.state().tables.tickets ?? []) as { id: string }[]).map(x => x.id)).toEqual(['A'])
    expect(d.health().ops).toBeGreaterThanOrEqual(before)
    const after = d.adapter.all('SELECT seq FROM dojo_ops ORDER BY seq').map(r => Number(r.seq))
    for (const s of seqs) expect(after).toContain(s)
    // and the next op continues the sequence
    const r = d.store.applyOps(put('D'))
    expect(r.seq).toBeGreaterThan(Math.max(...after))
  })

  it('each accepted op raises ops by exactly 1; a repeated opId counts 0', () => {
    const n0 = d.health().ops
    d.store.applyOps({ clientId: 'c', ops: [
      { tbl: 'settings', op: 'put', id: 'main', doc: { id: 'main', startDate: '2026-10-05' }, at: 'x', opId: 'o1' },
      { tbl: 'tickets', op: 'put', id: 'T', doc: { id: 'T' }, at: 'x', opId: 'o2' },
      { tbl: 'tickets', op: 'delete', id: 'T', at: 'x', opId: 'o3' },
    ] })
    expect(d.health().ops).toBe(n0 + 3)
    d.store.applyOps({ clientId: 'c', ops: [{ tbl: 'tickets', op: 'put', id: 'T', doc: { id: 'T' }, at: 'x', opId: 'o2' }] })
    expect(d.health().ops).toBe(n0 + 3)
    // the tombstone: gone from state, still counted in docs
    expect(d.store.state().tables.tickets).toBeUndefined()
    expect(d.health().docs).toBe(2)
  })

  it('31 manual backups leave exactly 30 manual files, listed newest first', () => {
    for (let i = 0; i < 31; i++) {
      day = new Date(2026, 8, 29, 12, 0, 0) // every one in the same second: the next free second
      d.backupNow()
    }
    const manual = d.listBackups().filter(b => /-\d{6}\.db$/.test(b.file))
    expect(manual).toHaveLength(30)
    const names = manual.map(b => b.file)
    expect(names).toEqual([...names].sort().reverse())
  })
})

describe('G4 #8: the restore op is stamped with the injected clock', () => {
  it('uses clock(), not the wall clock', () => {
    d.store.applyOps(put('A'))
    d.backup()
    day = new Date(2031, 0, 2, 3, 4, 5)
    d.restore('dojo-2026-09-29.db')
    const op = d.adapter.get("SELECT at FROM dojo_ops WHERE op = 'restore'")
    expect(op?.at).toBe(new Date(2031, 0, 2, 3, 4, 5).toISOString())
  })
})

describe('G4 #11: DOJO_HOME is private', () => {
  const mode = (p: string) => statSync(p).mode & 0o777
  it('0700 on DOJO_HOME; 0600 on dojo.db, every backup and a restored database', () => {
    expect(mode(home)).toBe(0o700)
    expect(mode(join(home, 'dojo.db'))).toBe(0o600)
    d.store.applyOps(put('A'))
    d.backup()
    const manual = d.backupNow().file
    for (const f of ['dojo-2026-09-29.db', manual]) expect(mode(join(home, 'backups', f)), f).toBe(0o600)
    const r = d.restore('dojo-2026-09-29.db')
    expect(mode(join(home, 'backups', r.preRestore))).toBe(0o600)
    expect(mode(join(home, 'dojo.db'))).toBe(0o600)
  })

  it('tightens an existing home and backups on start', () => {
    d.backup()
    chmodSync(home, 0o755)
    chmodSync(join(home, 'backups', 'dojo-2026-09-29.db'), 0o644)
    d.close()
    d = openDojo({ home, clock: () => day })
    expect(mode(home)).toBe(0o700)
    expect(mode(join(home, 'backups', 'dojo-2026-09-29.db'))).toBe(0o600)
  })
})

describe('Addenda 8/9: backups are listed and pruned by file name only', () => {
  it('seeded daily files (any contents) are capped at 30 on start, newest names kept; pre-restore never pruned', () => {
    d.close()
    for (let i = 1; i <= 35; i++) writeFileSync(join(home, 'backups', `dojo-2026-08-${String(i).padStart(2, '0')}.db`.replace('2026-08-32', '2026-09-01').replace('2026-08-33', '2026-09-02').replace('2026-08-34', '2026-09-03').replace('2026-08-35', '2026-09-04')), 'not a database')
    writeFileSync(join(home, 'backups', 'pre-restore-2020-01-01T00-00-00-000Z.db'), 'x')
    day = new Date(2026, 8, 4, 10) // today's daily already exists: no backup runs, pruning still must
    d = openDojo({ home, clock: () => day })
    const daily = d.listBackups().filter(b => /^dojo-\d{4}-\d{2}-\d{2}\.db$/.test(b.file)).map(b => b.file)
    expect(daily).toHaveLength(30)
    expect(daily[0]).toBe('dojo-2026-09-04.db')
    expect(daily).not.toContain('dojo-2026-08-05.db')
    expect(d.listBackups().some(b => b.file.startsWith('pre-restore-'))).toBe(true)
  })

  it('lists newest first by the date in the name, whatever the files\' mtimes', () => {
    writeFileSync(join(home, 'backups', 'dojo-2026-01-01.db'), 'x')
    writeFileSync(join(home, 'backups', 'dojo-2026-02-01.db'), 'x')
    utimesSync(join(home, 'backups', 'dojo-2026-02-01.db'), new Date(2000, 0, 1), new Date(2000, 0, 1))
    writeFileSync(join(home, 'backups', 'dojo-2026-01-15-120000.db'), 'x')
    writeFileSync(join(home, 'backups', 'pre-restore-2026-01-20T08-00-00-000Z.db'), 'x')
    expect(d.listBackups().map(b => b.file)).toEqual([
      'dojo-2026-02-01.db', 'pre-restore-2026-01-20T08-00-00-000Z.db', 'dojo-2026-01-15-120000.db', 'dojo-2026-01-01.db',
    ])
  })
})

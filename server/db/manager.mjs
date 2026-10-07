// Owns DOJO_HOME/dojo.db: opens + migrates it, hosts the store, takes VACUUM INTO backups and
// restores them. The adapter is swapped on restore, so everything reads it through a getter.
import { randomBytes } from 'node:crypto'
import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureDbId, openSqlite, runMigrations } from './adapter.mjs'
import { createStore, DbError } from './store.mjs'

export const KEEP_DATED_BACKUPS = 30
const DAILY = /^dojo-\d{4}-\d{2}-\d{2}\.db$/
const MANUAL = /^dojo-\d{4}-\d{2}-\d{2}-\d{6}\.db$/
const DATED = /^dojo-\d{4}-\d{2}-\d{2}(?:-\d{6})?\.db$/
const PRE_RESTORE = /^pre-restore-[A-Za-z0-9._-]+\.db$/
const pad = n => String(n).padStart(2, '0')

export function localDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Addendum 3: the writer token. Created once (random, DOJO_HOME/writer.token, mode 0600); only a
 * browser that holds it may write. The launcher opens the app with /#writer=<token>.
 */
export function ensureWriterToken(home) {
  const file = join(home, 'writer.token')
  try {
    writeFileSync(file, `${randomBytes(32).toString('base64url')}\n`, { mode: 0o600, flag: 'wx' })
  } catch (e) {
    if (e?.code !== 'EEXIST') throw e
  }
  chmodSync(file, 0o600)
  const token = readFileSync(file, 'utf8').trim()
  if (token.length < 32) throw new Error(`${file} does not hold a valid writer token; delete it to make a new one`)
  return token
}

/** fsync a file (or a directory, so a rename in it is durable). */
function fsyncPath(p) {
  const fd = openSync(p, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

/** Refuses anything that is not an intact Dojo database, without writing to it (read-only open). */
function probeBackup(src, file) {
  let probe = null
  try {
    probe = openSqlite(src, { readOnly: true })
    const check = probe.all('PRAGMA quick_check')
    if (check.length !== 1 || Object.values(check[0])[0] !== 'ok') throw new Error('quick_check failed')
    probe.get('SELECT COUNT(*) AS n FROM dojo_docs')
  } catch {
    throw new DbError(400, 'bad_request', `${file} is not a valid Dojo database`)
  } finally {
    try { probe?.close() } catch { /* never opened */ }
  }
}

/**
 * Addendum 5: a restore brings back the documents, never removes history. The backup's dojo_ops ends
 * where the backup was taken; append every later op from the pre-restore copy, then one 'restore' op
 * (not a document change) recording what happened.
 */
function keepHistory(adapter, preFile, restored, stamp, at) {
  adapter.run('ATTACH DATABASE ? AS pre', preFile)
  try {
    adapter.transaction(t => {
      const max = Number(t.get('SELECT COALESCE(MAX(seq), 0) AS n FROM dojo_ops').n)
      t.run(`INSERT INTO dojo_ops (seq, at, client_id, tbl, op, id, doc, op_id)
             SELECT seq, at, client_id, tbl, op, id, doc, op_id FROM pre.dojo_ops WHERE seq > ? ORDER BY seq`, max)
      const next = Number(t.get('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM dojo_ops').n)
      t.run('INSERT INTO dojo_ops (seq, at, client_id, tbl, op, id, doc, op_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        next, at, 'server', 'dojo_backups', 'restore', restored, JSON.stringify({ file: restored, preRestore: `pre-restore-${stamp}.db` }), null)
    })
  } finally {
    adapter.run('DETACH DATABASE pre')
  }
}

/** `hooks` exist for tests only: beforeSwap / afterSwap run inside the restore swap to inject failures. */
export function openDojo({ home, clock = () => new Date(), hooks = {} }) {
  mkdirSync(join(home, 'backups'), { recursive: true })
  // G4 #11: the learner's study data is theirs alone: DOJO_HOME 0700, the database and every backup 0600.
  const priv = p => { try { chmodSync(p, 0o600) } catch { /* not there */ } }
  function privatize() {
    chmodSync(home, 0o700)
    for (const ext of ['', '-wal', '-shm']) priv(join(home, 'dojo.db') + ext)
    for (const f of readdirSync(join(home, 'backups'))) if (f.endsWith('.db')) priv(join(home, 'backups', f))
  }
  mkdirSync(join(home, 'logs'), { recursive: true })
  const dbPath = join(home, 'dojo.db')
  const backupsDir = join(home, 'backups')
  // Leftovers of a backup or restore that crashed half-way; never valid data.
  for (const dir of [home, backupsDir]) {
    for (const f of readdirSync(dir)) if (f.startsWith('.tmp-')) rmSync(join(dir, f), { force: true, recursive: true })
  }
  const writerToken = ensureWriterToken(home)
  prune() // Addendum 8: the caps hold from the start, even when no backup is taken on this start
  let adapter = openSqlite(dbPath)
  privatize()
  runMigrations(adapter)
  const store = createStore(() => adapter, () => clock().toISOString())

  /**
   * Addenda 8/9: backups are listed and pruned by file NAME only (no file is opened). The time comes
   * from the name (dojo-YYYY-MM-DD[-HHMMSS].db local time, pre-restore-<ISO stamp>.db); only an
   * oddly named pre-restore file falls back to its mtime.
   */
  function sameLocalDay(a, b) {
    const x = new Date(a), y = new Date(b)
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
  }

  function nameTime(file) {
    let m = /^dojo-(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2})(\d{2}))?\.db$/.exec(file)
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime()
    m = /^pre-restore-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.db$/.exec(file)
    if (m) return Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)
    return null
  }

  function listBackups() {
    return readdirSync(backupsDir)
      .filter(f => DATED.test(f) || PRE_RESTORE.test(f))
      .map(file => {
        const st = statSync(join(backupsDir, file))
        const named = nameTime(file)
        // UAT r3 J8: a daily snapshot's name has only the day ("2026-10-05 00:00" for one taken at 19:53), so its
        // time is the file's own mtime, when that is on the named day (a copied-in file keeps the name's day).
        const t = named !== null && DAILY.test(file) && sameLocalDay(st.mtime.getTime(), named) ? st.mtime.getTime() : named ?? st.mtime.getTime()
        return { file, bytes: st.size, at: new Date(t).toISOString(), t }
      })
      .sort((x, y) => (y.t - x.t) || (y.file < x.file ? -1 : 1))
      .map(({ t: _t, ...b }) => b)
  }

  function prune() {
    // Daily and manual snapshots are capped separately; pre-restore files are never pruned.
    for (const re of [DAILY, MANUAL]) {
      const files = readdirSync(backupsDir).filter(f => re.test(f)).sort().reverse()
      for (const f of files.slice(KEEP_DATED_BACKUPS)) rmSync(join(backupsDir, f), { force: true })
    }
  }

  /** manual=false: the daily snapshot (plain date name, replaced if retaken). manual=true: "Back up now". */
  function backup(manual = false) {
    const c = clock()
    const manualName = t => `dojo-${localDate(t)}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}.db`
    let file = manual ? manualName(c) : `dojo-${localDate(c)}.db`
    // Two "Back up now" in one second must not overwrite each other: take the next free second, which
    // keeps the pinned dojo-YYYY-MM-DD-HHMMSS.db shape (a counter or milliseconds would change it).
    for (let i = 1; manual && existsSync(join(backupsDir, file)); i++) file = manualName(new Date(c.getTime() + i * 1000))
    const tmp = join(backupsDir, `.tmp-${process.pid}.db`)
    rmSync(tmp, { force: true })
    adapter.backupTo(tmp)
    priv(tmp)
    renameSync(tmp, join(backupsDir, file))
    prune()
    return { ok: true, file, bytes: statSync(join(backupsDir, file)).size }
  }

  function ensureTodaysBackup() {
    return existsSync(join(backupsDir, `dojo-${localDate(clock())}.db`)) ? null : backup()
  }

  /**
   * I4 + G4 #2: atomic restore. The backup is probed read-only and copied to a temp file next to
   * dojo.db. The live database is snapshotted (pre-restore). Then the WHOLE restore happens on the temp
   * copy: migrations, the history carried over from the pre-restore snapshot (Addendum 5), a new db_id;
   * it is closed (a single file, no WAL) and fsynced. Only then is it renamed over dojo.db and the OLD
   * database's -wal/-shm removed. A crash at any point leaves either the old database or the complete
   * restored one. Any failure reopens the old contents (from the pre-restore copy after the rename).
   */
  function restore(file) {
    if (typeof file !== 'string' || !(DATED.test(file) || PRE_RESTORE.test(file))) throw new DbError(400, 'bad_request', 'unknown backup file name')
    const src = join(backupsDir, file)
    if (!existsSync(src)) throw new DbError(404, 'not_found', `no backup ${file}`)
    probeBackup(src, file)
    const stamp = clock().toISOString().replace(/[:.]/g, '-')
    const pre = `pre-restore-${stamp}.db`
    const tmp = join(home, `.tmp-restore-${process.pid}-${Date.now()}.db`)
    const dropTmp = () => { for (const ext of ['', '-wal', '-shm', '-journal']) rmSync(tmp + ext, { force: true }) }
    const swapIn = from => {
      if (from !== tmp) copyFileSync(from, tmp)
      fsyncPath(tmp)
      renameSync(tmp, dbPath)
      for (const ext of ['-wal', '-shm']) rmSync(dbPath + ext, { force: true })
      fsyncPath(home)
    }
    try {
      copyFileSync(src, tmp)
      adapter.backupTo(join(backupsDir, pre))
      priv(join(backupsDir, pre))
      priv(tmp)
      const next = openSqlite(tmp)
      try {
        next.exec('PRAGMA journal_mode = DELETE') // one self-contained file to rename
        runMigrations(next)
        keepHistory(next, join(backupsDir, pre), file, stamp, clock().toISOString())
        ensureDbId(next, { rotate: true }) // C2: browsers synced to the old contents must re-adopt
      } finally {
        next.close()
      }
      fsyncPath(tmp)
    } catch (e) {
      dropTmp()
      throw e
    }
    adapter.close()
    let swapped = false
    try {
      hooks.beforeSwap?.()
      swapIn(tmp)
      swapped = true
      hooks.afterSwap?.()
      adapter = openSqlite(dbPath)
      runMigrations(adapter)
      privatize()
    } catch (e) {
      try { adapter.close() } catch { /* already closed */ }
      dropTmp()
      if (swapped) swapIn(join(backupsDir, pre))
      adapter = openSqlite(dbPath)
      runMigrations(adapter)
      throw e
    }
    return { ok: true, restored: file, preRestore: pre }
  }

  let timer = null
  return {
    writerToken,
    home, dbPath, store, listBackups, backup, backupNow: () => backup(true), ensureTodaysBackup, restore,
    get adapter() { return adapter },
    health() {
      // pre-restore files are safety copies, not backups taken on schedule or on request
      return store.health(listBackups().find(b => DATED.test(b.file))?.at ?? null)
    },
    startBackupTimer(ms = 24 * 60 * 60 * 1000) {
      timer = setInterval(() => { try { backup() } catch (e) { console.error('backup failed', e) } }, ms)
      timer.unref?.()
    },
    close() {
      if (timer) clearInterval(timer)
      adapter.close()
    },
  }
}

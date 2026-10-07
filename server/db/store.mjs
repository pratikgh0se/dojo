// Document store over a SqliteAdapter: current state in dojo_docs, append-only history in dojo_ops.
// Every mutation runs in ONE transaction. Deletes are tombstones; dojo_ops is never updated/deleted.
export class DbError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

const OPS = new Set(['put', 'delete', 'clear'])
// I3: the browser's ++seq tables. Their disk ids are `${clientId}:${seq}` (sent by the client).
export const APPEND_ONLY = new Set(['events', 'aiLog', 'atlasRuns'])
const bad = m => new DbError(400, 'bad_request', m)

function checkOp(o, i) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw bad(`ops[${i}] must be an object`)
  if (typeof o.tbl !== 'string' || o.tbl === '' || o.tbl.startsWith('_')) throw bad(`ops[${i}].tbl is invalid`)
  if (!OPS.has(o.op)) throw bad(`ops[${i}].op must be put, delete or clear`)
  if (o.op !== 'clear' && (typeof o.id !== 'string' || o.id === '')) throw bad(`ops[${i}].id must be a non-empty string`)
  if (o.op === 'put' && (o.doc === undefined || o.doc === null)) throw bad(`ops[${i}].doc is required for put`)
  if (o.opId !== undefined && (typeof o.opId !== 'string' || o.opId === '')) throw bad(`ops[${i}].opId must be a string`)
  if (o.at !== undefined && typeof o.at !== 'string') throw bad(`ops[${i}].at must be a string`)
  if (o.known !== undefined && typeof o.known !== 'boolean') throw bad(`ops[${i}].known must be a boolean`)
  if (o.create !== undefined && typeof o.create !== 'boolean') throw bad(`ops[${i}].create must be a boolean`)
}

function checkClient(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('body must be a JSON object')
  if (typeof body.clientId !== 'string' || body.clientId === '') throw bad('clientId is required')
  if (body.dbId !== undefined && typeof body.dbId !== 'string') throw bad('dbId must be a string')
}

export function createStore(getAdapter, now = () => new Date().toISOString()) {
  const a = () => getAdapter()
  const nextSeq = t => Number(t.get('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM dojo_ops').n)
  const dbId = t => t.get(`SELECT value FROM dojo_meta WHERE key = 'db_id'`)?.value ?? null
  // "Has data" means ANY row, tombstones included (a browser's fresh start needs a truly empty disk).
  const anyDocs = t => Number(t.get('SELECT COUNT(*) AS n FROM dojo_docs').n)
  /** C2: the writer stamps its writes with the db_id it adopted; another database refuses them. */
  function checkDb(t, body) {
    if (body.dbId !== undefined && body.dbId !== dbId(t)) {
      throw new DbError(409, 'db_mismatch', 'this browser has not adopted this database; reload to adopt it')
    }
  }

  function appendOp(t, seq, clientId, o, at) {
    t.run(
      'INSERT INTO dojo_ops (seq, at, client_id, tbl, op, id, doc, op_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      seq, at, clientId, o.tbl, o.op, o.id ?? null, o.doc !== undefined && o.op !== 'delete' && o.op !== 'clear' ? JSON.stringify(o.doc) : null, o.opId ?? null,
    )
  }

  function applyDoc(t, o, at) {
    if (o.op === 'put') {
      t.run(
        `INSERT INTO dojo_docs (tbl, id, doc, updated_at, deleted) VALUES (?, ?, ?, ?, 0)
         ON CONFLICT (tbl, id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at, deleted = 0`,
        o.tbl, o.id, JSON.stringify(o.doc), at,
      )
    } else if (o.op === 'delete') {
      // A tombstone keeps the last doc; deleting an id the disk never had records the op but invents no doc.
      t.run('UPDATE dojo_docs SET deleted = 1, updated_at = ? WHERE tbl = ? AND id = ?', at, o.tbl, o.id)
    } else {
      t.run('UPDATE dojo_docs SET deleted = 1, updated_at = ? WHERE tbl = ? AND deleted = 0', at, o.tbl)
    }
  }

  /**
   * Append-only ids never collide silently. The same content again is a harmless retry. Otherwise:
   *  - Minor 4: a new row (create) never overwrites an existing id, live or tombstoned (e.g. a browser
   *    restored from an old copy, reusing its seqs);
   *  - Addendum 2: a put from another client than the doc's last writer is refused unless it declares
   *    known: true (an edit of a row it hydrated from here).
   */
  function checkCollision(t, clientId, o, i) {
    const cur = t.get('SELECT doc, deleted FROM dojo_docs WHERE tbl = ? AND id = ?', o.tbl, o.id)
    if (!cur || cur.doc === JSON.stringify(o.doc)) return
    if (o.create === true) throw new DbError(409, 'conflict', `ops[${i}]: ${o.tbl}/${o.id} already exists; a new row may not overwrite it`)
    if (o.known === true || Number(cur.deleted) === 1) return
    const last = t.get("SELECT client_id FROM dojo_ops WHERE tbl = ? AND id = ? AND op IN ('put', 'delete') ORDER BY seq DESC LIMIT 1", o.tbl, o.id)
    if (last && last.client_id !== clientId) {
      throw new DbError(409, 'conflict', `ops[${i}]: ${o.tbl}/${o.id} was written by another client with different content`)
    }
  }


  return {
    health(lastBackup = null) {
      return {
        ok: true,
        dbPath: a().path,
        dbId: dbId(a()),
        docs: anyDocs(a()),
        ops: Number(a().get('SELECT COUNT(*) AS n FROM dojo_ops').n),
        lastBackup,
      }
    },

    state() {
      // SEC-D-08: a Map, not `{}`: a table named "constructor" or "toString" must not find Object.prototype's
      // member (a TypeError on push, and every /db/state a 500 until the row was gone)
      const tables = new Map()
      for (const r of a().all('SELECT tbl, doc FROM dojo_docs WHERE deleted = 0 ORDER BY tbl, id')) {
        let rows = tables.get(r.tbl)
        if (!rows) tables.set(r.tbl, (rows = []))
        rows.push(JSON.parse(r.doc))
      }
      return { tables: Object.fromEntries(tables) }
    },

    applyOps(body) {
      checkClient(body)
      if (!Array.isArray(body.ops)) throw bad('ops must be an array')
      body.ops.forEach(checkOp)
      return a().transaction(t => {
        checkDb(t, body)
        let applied = 0
        let seq = nextSeq(t) - 1
        for (const [i, o] of body.ops.entries()) {
          if (o.opId && t.get('SELECT 1 AS x FROM dojo_ops WHERE op_id = ?', o.opId)) continue
          if (o.op === 'put' && APPEND_ONLY.has(o.tbl)) checkCollision(t, body.clientId, o, i)
          const at = typeof o.at === 'string' && o.at ? o.at : now()
          seq += 1
          appendOp(t, seq, body.clientId, o, at)
          applyDoc(t, o, at)
          applied += 1
        }
        return { ok: true, applied, seq }
      })
    },

  }
}

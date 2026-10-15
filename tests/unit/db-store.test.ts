// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openSqlite, runMigrations, type SqliteAdapter } from '../../server/db/adapter.mjs'
import { createStore, type Store } from '../../server/db/store.mjs'

let a: SqliteAdapter
let s: Store
const put = (tbl: string, id: string, doc: object, opId?: string) => ({ tbl, op: 'put', id, doc, at: '2026-01-01T00:00:00.000Z', opId })

beforeEach(() => {
  a = openSqlite(':memory:')
  runMigrations(a)
  s = createStore(() => a)
})

describe('SEC-D-08: table names that are Object.prototype members', () => {
  it.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf'])('a table named %s round-trips and /db/state keeps working', tbl => {
    s.applyOps({ clientId: 'c', ops: [put(tbl, 'x', { id: 'x' }), put('tickets', 't1', { id: 't1' })] })
    const { tables } = s.state()
    expect(Object.prototype.hasOwnProperty.call(tables, tbl)).toBe(true)
    expect(tables[tbl]).toEqual([{ id: 'x' }])
    expect(tables.tickets).toEqual([{ id: 't1' }])
    expect(JSON.parse(JSON.stringify(s.state())).tables[tbl]).toEqual([{ id: 'x' }])
  })
  it('__proto__ (and every _ name) is still refused', () => {
    expect(() => s.applyOps({ clientId: 'c', ops: [put('__proto__', 'x', { id: 'x' })] })).toThrow(/tbl is invalid/)
  })
})

describe('applyOps', () => {
  it('upserts docs and appends history', () => {
    const r = s.applyOps({ clientId: 'c', ops: [put('tickets', 't1', { id: 't1', status: 'todo' }), put('tickets', 't1', { id: 't1', status: 'done' })] })
    expect(r).toEqual({ ok: true, applied: 2, seq: 2 })
    expect(s.state().tables.tickets).toEqual([{ id: 't1', status: 'done' }])
    expect(s.health().ops).toBe(2)
  })

  it('is idempotent per opId', () => {
    const body = { clientId: 'c', ops: [put('tickets', 't1', { id: 't1' }, 'op-1')] }
    expect(s.applyOps(body).applied).toBe(1)
    expect(s.applyOps(body).applied).toBe(0)
    expect(s.health().ops).toBe(1)
  })

  it('delete tombstones, keeping the last doc and history', () => {
    s.applyOps({ clientId: 'c', ops: [put('tickets', 't1', { id: 't1' }), { tbl: 'tickets', op: 'delete', id: 't1', at: 'x' }] })
    expect(s.state().tables).toEqual({})
    expect(a.get("SELECT deleted, doc FROM dojo_docs WHERE id='t1'")).toEqual({ deleted: 1, doc: '{"id":"t1"}' })
    expect(s.health().ops).toBe(2)
  })

  it('clear tombstones every row of that table only', () => {
    s.applyOps({ clientId: 'c', ops: [put('a', '1', { id: '1' }), put('a', '2', { id: '2' }), put('b', '1', { id: '1' }), { tbl: 'a', op: 'clear', at: 'x' }] })
    expect(Object.keys(s.state().tables)).toEqual(['b'])
    s.applyOps({ clientId: 'c', ops: [put('a', '1', { id: '1', back: true })] })
    expect(s.state().tables.a).toEqual([{ id: '1', back: true }])
  })

  it('a failing op rolls back the whole batch', () => {
    expect(() => s.applyOps({ clientId: 'c', ops: [put('a', '1', { id: '1' }), { tbl: 'a', op: 'nope' }] })).toThrow()
    expect(s.health().ops).toBe(0)
  })

  it('one poison op in a batch of many leaves the store exactly as it was (the premise of outbox groups), on a real file in a scratch home', () => {
    const home = mkdtempSync(join(tmpdir(), 'dojo-store-atomic-'))
    const fa = openSqlite(join(home, 'dojo.db'))
    try {
      runMigrations(fa)
      const fs = createStore(() => fa)
      fs.applyOps({ clientId: 'c', ops: [put('tickets', 'keep', { id: 'keep', v: 1 }, 'op-keep'), put('a', '1', { id: '1' }, 'op-a1')] })
      const before = JSON.stringify({ state: fs.state(), ops: fs.health().ops })
      const batch = (poison: object) => ({
        clientId: 'c',
        ops: [put('tickets', 'new1', { id: 'new1' }, 'op-n1'), put('tickets', 'keep', { id: 'keep', v: 2 }, 'op-k2'), { tbl: 'a', op: 'clear', at: 'x', opId: 'op-clr' }, put('tickets', 'new2', { id: 'new2' }, 'op-n2'), poison],
      })
      // a malformed op (400) and an append-only collision (409) both roll the whole batch back
      expect(() => fs.applyOps(batch({ tbl: 'tickets', op: 'nope', id: 'x', at: 'x', opId: 'op-bad' }))).toThrow()
      expect(JSON.stringify({ state: fs.state(), ops: fs.health().ops })).toBe(before)
      fs.applyOps({ clientId: 'c', ops: [{ tbl: 'events', op: 'put', id: 'k:1', doc: { t: 'tick' }, at: 'x', create: true }] })
      const mid = JSON.stringify({ state: fs.state(), ops: fs.health().ops })
      expect(() => fs.applyOps(batch({ tbl: 'events', op: 'put', id: 'k:1', doc: { t: 'other' }, at: 'x', create: true, opId: 'op-col' }))).toThrowError(expect.objectContaining({ status: 409 }))
      expect(JSON.stringify({ state: fs.state(), ops: fs.health().ops })).toBe(mid)
      // none of the batch's opIds were recorded, so the same ops apply once the poison is removed
      const ok = fs.applyOps({ ...batch(put('tickets', 'last', { id: 'last' }, 'op-last')) })
      expect(ok.applied).toBe(5)
    } finally {
      fa.close?.()
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('rejects malformed bodies and reserved tables', () => {
    expect(() => s.applyOps(null)).toThrow(/object/)
    expect(() => s.applyOps({ clientId: '', ops: [] })).toThrow(/clientId/)
    expect(() => s.applyOps({ clientId: 'c', ops: [put('_outbox', '1', {})] })).toThrow(/tbl/)
  })

  it('history count never decreases', () => {
    let last = 0
    for (let i = 0; i < 4; i++) {
      s.applyOps({ clientId: 'c', ops: [i % 2 ? { tbl: 'a', op: 'delete', id: '1', at: 'x' } : put('a', '1', { id: '1' })] })
      const n = s.health().ops
      expect(n).toBeGreaterThan(last)
      last = n
    }
  })
})

describe('Minor 4: a create never overwrites an existing append-only id', () => {
  const ev = (id: string, doc: object, extra: object = {}) => ({ tbl: 'events', op: 'put', id, doc, at: 'x', ...extra })
  it('a create:true put to an existing id with different content is 409 conflict (live or tombstoned)', () => {
    s.applyOps({ clientId: 'w', ops: [ev('k:101', { t: 'tick', id: 'p1' }, { create: true })] })
    expect(() => s.applyOps({ clientId: 'w', ops: [ev('k:101', { t: 'untick', id: 'p9' }, { create: true })] }))
      .toThrowError(expect.objectContaining({ status: 409, code: 'conflict' }))
    expect(s.state().tables.events).toEqual([{ t: 'tick', id: 'p1' }])
    s.applyOps({ clientId: 'w', ops: [{ tbl: 'events', op: 'delete', id: 'k:101', at: 'x' }] })
    expect(() => s.applyOps({ clientId: 'w', ops: [ev('k:101', { t: 'again' }, { create: true })] })).toThrowError(expect.objectContaining({ status: 409 }))
  })

  it('allows the same content again, an edit (no create), and other tables; accepts the known field', () => {
    s.applyOps({ clientId: 'w', ops: [ev('k:1', { t: 'tick' }, { create: true })] })
    expect(s.applyOps({ clientId: 'w', ops: [ev('k:1', { t: 'tick' }, { create: true })] }).applied).toBe(1)
    expect(s.applyOps({ clientId: 'w', ops: [ev('k:1', { t: 'tick', v: 2 })] }).applied).toBe(1)
    expect(s.applyOps({ clientId: 'w', ops: [ev('k:1', { t: 'tick', v: 3 }, { known: true })] }).applied).toBe(1)
    s.applyOps({ clientId: 'w', ops: [{ tbl: 'tickets', op: 'put', id: 't', doc: { v: 1 }, at: 'x', create: true }] })
    expect(s.applyOps({ clientId: 'w', ops: [{ tbl: 'tickets', op: 'put', id: 't', doc: { v: 2 }, at: 'x', create: true }] }).applied).toBe(1)
  })
})


describe('a delete of an id the disk never had', () => {
  it('records the op (ops +1) but invents no tombstone (docs unchanged)', () => {
    s.applyOps({ clientId: 'c', ops: [put('tickets', 't1', { id: 't1' })] })
    const h0 = s.health()
    s.applyOps({ clientId: 'c', ops: [{ tbl: 'tickets', op: 'delete', id: 'never-there', at: 'x' }] })
    expect(s.health()).toMatchObject({ docs: h0.docs, ops: h0.ops + 1 })
    expect(a.get("SELECT COUNT(*) AS n FROM dojo_docs WHERE id = 'never-there'")?.n).toBe(0)
  })
})

describe('Addendum 2: another client may not overwrite an append-only doc unless it declares known:true', () => {
  const ev = (id: string, doc: object, extra: object = {}) => ({ tbl: 'events', op: 'put', id, doc, at: 'x', ...extra })
  it('409 conflict from a different client with different content; known:true, the same content or the same client pass', () => {
    s.applyOps({ clientId: 'a', ops: [ev('a:1', { t: 'tick' })] })
    expect(() => s.applyOps({ clientId: 'b', ops: [ev('a:1', { t: 'untick' })] })).toThrowError(expect.objectContaining({ status: 409, code: 'conflict' }))
    expect(s.applyOps({ clientId: 'b', ops: [ev('a:1', { t: 'tick' })] }).applied).toBe(1)
    expect(s.applyOps({ clientId: 'b', ops: [ev('a:1', { t: 'renamed' }, { known: true })] }).applied).toBe(1)
    expect(s.applyOps({ clientId: 'b', ops: [ev('a:1', { t: 'again' })] }).applied).toBe(1) // b is now the last writer
  })
})

// Dexie DBCore middleware: every successful mutate on an app table is recorded as put/delete/clear
// ops in `_outbox`, inside the SAME IndexedDB transaction, so a write and its outbox entry land
// together or not at all. Tables whose name starts with "_" (sync bookkeeping) are never observed.
import type { DBCore, DBCoreMutateRequest, DBCoreTable, Middleware } from 'dexie'
import type { OutboxRow } from '../db'
import { APPEND_ONLY, diskIdOf, isKnownDiskRow, toDiskDoc } from './diskIds'
import { keyToId, newOpId } from './keys'
import { ReadOnlyError } from '../writer'

export interface SyncGate {
  /** While true (hydrate), writes pass through without producing outbox entries. */
  bypass: boolean
  /** Addendum 3: a browser without the writer token; every app-table write is refused. */
  readOnly?: boolean
  /** This browser's id (from _meta). Resolved inside the write transaction when not yet known. */
  clientId?: string
  /** Called with the queued rows once their transaction COMMITS (never for an aborted one). */
  onQueued?: (rows: OutboxRow[]) => void
}

const FULL_RANGE = 3 // DBCoreRangeType.Any

export { keyToId, newOpId }

/** Structural equality for stored (structured-clone) values; unknown object kinds count as different. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime()
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameValue(x, b[i]))
  }
  const pa = Object.getPrototypeOf(a), pb = Object.getPrototypeOf(b)
  if ((pa !== Object.prototype && pa !== null) || (pb !== Object.prototype && pb !== null)) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

export function outboxMiddleware(gate: SyncGate): Middleware<DBCore> {
  return {
    stack: 'dbcore',
    name: 'dojoOutbox',
    create(down) {
      const outbox = (): DBCoreTable => down.table('_outbox')
      const at = () => new Date().toISOString()
      const row = (tbl: string, op: OutboxRow['op'], id?: string, doc?: unknown, flags: Pick<OutboxRow, 'create' | 'known'> = {}): OutboxRow => ({
        opId: newOpId(), tbl, op, ...(id === undefined ? {} : { id }), ...(doc === undefined ? {} : { doc }), ...flags, at: at(),
      })
      const afterCommit = (req: DBCoreMutateRequest, fn: () => void) => {
        const tx = req.trans as unknown as Partial<EventTarget>
        if (typeof tx.addEventListener === 'function') tx.addEventListener('complete', fn, { once: true })
        else fn()
      }
      const queue = async (req: DBCoreMutateRequest, rows: OutboxRow[]) => {
        if (rows.length === 0) return
        await outbox().mutate({ type: 'add', trans: req.trans, values: rows })
        afterCommit(req, () => gate.onQueued?.(rows))
      }
      /** The client id, read (or created) inside this transaction when boot has not set it yet. */
      const clientId = async (req: DBCoreMutateRequest): Promise<string> => {
        if (gate.clientId) return gate.clientId
        const meta = down.table('_meta')
        const have = (await meta.get({ trans: req.trans, key: 'clientId' })) as { value?: unknown } | undefined
        if (typeof have?.value === 'string' && have.value) return (gate.clientId = have.value)
        const id = newOpId()
        await meta.mutate({ type: 'put', trans: req.trans, values: [{ key: 'clientId', value: id }] })
        afterCommit(req, () => { gate.clientId ??= id })
        return id
      }
      return {
        ...down,
        // Every read-write transaction also includes the outbox (to queue ops) and _meta (client id).
        transaction(stores, mode, options) {
          const extra = mode === 'readwrite' ? ['_outbox', '_meta'].filter(x => !stores.includes(x)) : []
          return down.transaction(extra.length ? [...stores, ...extra] : stores, mode, options)
        },
        table(name) {
          const t = down.table(name)
          if (name.startsWith('_')) return t
          const appendOnly = APPEND_ONLY.has(name)
          return {
            ...t,
            async mutate(req) {
              if (gate.bypass) return t.mutate(req)
              if (gate.readOnly) throw new ReadOnlyError()
              if (appendOnly && req.type === 'add' && req.values.some(v => v && typeof v === 'object' && '_diskId' in v)) {
                // An added row is a NEW row: a copied _diskId would make it overwrite the original on disk.
                req = { ...req, values: req.values.map(v => {
                  if (!v || typeof v !== 'object' || !('_diskId' in v)) return v
                  const { _diskId: _d, ...rest } = v as Record<string, unknown>
                  return rest
                }) }
              }
              const pk = t.schema.primaryKey
              let preDeleted: unknown[] | null = null
              if (req.type === 'deleteRange' && (req.range.type !== FULL_RANGE || appendOnly)) {
                // Partial range (or an append-only table, whose disk ids live in the docs): learn the keys first.
                preDeleted = (await t.query({ trans: req.trans, values: false, query: { index: pk, range: req.range } })).result
              }
              // Append-only deletes need each doc's disk id before it is gone.
              const delKeys = req.type === 'delete' ? req.keys : preDeleted
              const delDocs = appendOnly && delKeys?.length ? await t.getMany({ trans: req.trans, keys: delKeys }) : null
              // I6: the stored values a put replaces, read in the same transaction, so no-op puts (every
              // boot's reconcile re-puts the same tickets and settings) record nothing.
              let before: unknown[] | null = null
              if (req.type === 'put') {
                const extract = pk.extractKey
                const keys = req.keys ?? (extract ? req.values.map(v => extract(v)) : null)
                if (keys && keys.every(k => k !== undefined)) before = await t.getMany({ trans: req.trans, keys })
              }
              const res = await t.mutate(req)
              // Only Dexie promises may be awaited before t.mutate (a native await drops Dexie's zone).
              const cid = appendOnly ? await clientId(req) : ''
              const failed = new Set(Object.keys(res.failures ?? {}).map(Number))
              const idOf = (k: unknown, doc: unknown) => diskIdOf(name, k, doc, cid)
              if (req.type === 'add' || req.type === 'put') {
                const idx = (res.results ?? []).map((_, i) => i).filter(i => !failed.has(i))
                const keys = idx.map(i => res.results![i])
                const docs = keys.length ? await t.getMany({ trans: req.trans, keys }) : []
                const ofTarget = async (seq: number) => {
                  const target = await t.get({ trans: req.trans, key: seq })
                  return target == null ? undefined : idOf(seq, target)
                }
                const rows: OutboxRow[] = []
                for (let i = 0; i < keys.length; i++) {
                  const doc = docs[i]
                  if (doc == null) continue
                  if (before && sameValue(before[idx[i]], doc)) continue // I6: nothing changed
                  const id = idOf(keys[i], doc)
                  const of = appendOnly && typeof (doc as { of?: unknown }).of === 'number' ? await ofTarget((doc as { of: number }).of) : undefined
                  // Minor 4: a new append-only row goes as a create, which never overwrites an existing id.
                  const flags = !appendOnly ? {} : req.type === 'add' ? { create: true } : isKnownDiskRow(doc) ? { known: true } : {}
                  rows.push(row(name, 'put', id, toDiskDoc(name, id, doc, () => of), flags))
                }
                await queue(req, rows)
              } else if (req.type === 'delete' || preDeleted) {
                const keys = (req.type === 'delete' ? req.keys : preDeleted!)
                await queue(req, keys.flatMap((k, i) => (failed.has(i) && req.type === 'delete' ? [] : [row(name, 'delete', idOf(k, delDocs?.[i]))])))
              } else {
                await queue(req, [row(name, 'clear')])
              }
              return res
            },
          }
        },
      }
    },
  }
}

/** Installs the middleware on a Dexie instance (must run before the database is opened). */
export function installOutbox(d: { use(m: Middleware<DBCore>): unknown }, gate: SyncGate): void {
  d.use(outboxMiddleware(gate))
}

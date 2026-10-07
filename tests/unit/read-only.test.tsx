import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { openSqlite, runMigrations } from '../../server/db/adapter.mjs'
import { createStore, DbError, type Store } from '../../server/db/store.mjs'
import { createDb } from '../../src/data/db'
import { safeWrite } from '../../src/data/safeWrite'
import { hydrate } from '../../src/data/sync/hydrate'
import { createSyncLoop } from '../../src/data/sync/loop'
import type { SyncGate } from '../../src/data/sync/middleware'
import { getSaveState } from '../../src/data/sync/status'
import { READ_ONLY_MESSAGE } from '../../src/data/writer'
import { ReadOnlyBanner } from '../../src/ui/ReadOnlyBanner'
import { mkTicket } from '../helpers/tickets'

// Addendum 3: a browser without the writer token shows the disk's state and can change nothing.
let n = 0
function server(store: Store, calls: string[]): typeof fetch {
  return async (input, init) => {
    const path = new URL(String(input), 'http://x').pathname
    calls.push(`${init?.method ?? 'GET'} ${path}`)
    const body = init?.body ? JSON.parse(String(init.body)) : null
    const reply = (status: number, b: unknown) => new Response(JSON.stringify(b), { status })
    try {
      if (path === '/db/health') return reply(200, store.health())
      if (path === '/db/state') return reply(200, store.state())
      if (path === '/db/ops') return reply(200, store.applyOps(body))
    } catch (e) { if (e instanceof DbError) return reply(e.status, { ok: false }) ; throw e }
    return reply(404, {})
  }
}

describe('read-only browsers', () => {
  it('refuse every app-table write with the read-only message and queue nothing', async () => {
    const gate: SyncGate = { bypass: false, readOnly: true }
    const d = createDb(`ro-${n++}`, gate)
    await expect(d.tickets.put(mkTicket({ id: 'x' }))).rejects.toThrow(READ_ONLY_MESSAGE)
    expect(await d.tickets.count()).toBe(0)
    expect(await d._outbox.count()).toBe(0)
    gate.bypass = true // hydrate's own writes
    await d.tickets.put(mkTicket({ id: 'x' }))
    expect(await d.tickets.count()).toBe(1)
  })

  it('safeWrite turns the refusal into the "Read-only" toast (Addendum 4 Q1)', async () => {
    const gate: SyncGate = { bypass: false, readOnly: true }
    const d = createDb(`ro-${n++}`, gate)
    const toasts: string[] = []
    expect(await safeWrite(() => d.tickets.put(mkTicket({ id: 'x' })), m => toasts.push(m))).toBeUndefined()
    expect(toasts).toEqual([READ_ONLY_MESSAGE])
    expect(READ_ONLY_MESSAGE).toMatch(/^Read-only/)
  })

  it('hydrate shows the disk state, never posts, never adopts, whatever the browser holds', async () => {
    const a = openSqlite(':memory:'); runMigrations(a)
    const store = createStore(() => a)
    store.applyOps({ clientId: 'writer', ops: [{ tbl: 'tickets', op: 'put', id: 'A', doc: mkTicket({ id: 'A', status: 'done' }), at: 'x' }] })
    const gate: SyncGate = { bypass: false, readOnly: true }
    const d = createDb(`ro-${n++}`, gate)
    gate.bypass = true
    await d.tickets.put(mkTicket({ id: 'local-only', status: 'done' }))
    gate.bypass = false
    const calls: string[] = []
    const f = server(store, calls)
    const loop = createSyncLoop({ db: d, clientId: 'ro', fetchImpl: f, pollMs: 60_000 })
    expect(await hydrate({ db: d, gate, loop, clientId: 'ro', fetchImpl: f, readOnly: true })).toBe('readonly')
    expect((await d.tickets.toArray()).map(t => [t.id, t.status])).toEqual([['A', 'done']])
    expect(await d._meta.get('syncedDb')).toBeUndefined()
    expect(calls.every(c => c.startsWith('GET'))).toBe(true)
    expect(store.health().ops).toBe(1)
    expect(getSaveState()).toBe('offline')
  })

  it('the banner says how to make changes', () => {
    render(<ReadOnlyBanner readOnly />)
    expect(screen.getByTestId('readonly-banner')).toHaveTextContent('Read-only: open Dojo from the Dojo app to make changes')
  })
})

// Lazy entry to disk sync (its own chunk, so the entry bundle stays small): reconcile with the
// server and start the loop. The outbox middleware itself is installed statically in db.ts. Never throws; on any failure the app
// simply runs on Dexie alone with the "Not saved to disk" indicator.
import type { DojoDB } from '../db'
import { getClientId, getSyncedDb, hydrate, type HydrateResult } from './hydrate'
import { createSyncLoop, type SyncLoop } from './loop'
import { syncGate } from '../db'
import type { SyncGate } from './middleware'
import { registerSyncControls, setSaveState, syncControlsDefaults, type SyncControls } from './status'

export interface DiskSync { result: HydrateResult | 'error'; loop: SyncLoop | null; controls?: SyncControls }

export interface DiskSyncOptions {
  base?: string
  fetchImpl?: typeof fetch
  /** The gate the db's outbox middleware was created with (db.ts installs it statically, I8). */
  gate?: SyncGate
  /** I-c: the BroadcastChannel every Dojo tab listens on, and how a tab reloads (tests override both). */
  channelName?: string
  reload?: () => void
  pollMs?: number
}

type SyncMessage = { type: 'restoring' | 'restore-cancelled' | 'restored' }

export async function startDiskSync(db: DojoDB, opts: DiskSyncOptions = {}): Promise<DiskSync> {
  const { gate = syncGate, channelName = 'dojo-sync', reload = () => window.location.reload(), pollMs, ...net } = opts
  let loop: SyncLoop | null = null
  try {
    await db.open()
    const clientId = await getClientId(db)
    gate.clientId = clientId
    if (gate.readOnly) {
      // Addendum 3: no writer token. Load the disk's state; no loop, no posts, no adoption.
      const f: typeof fetch = net.fetchImpl ?? ((i, n) => globalThis.fetch(i, n))
      const probe = createSyncLoop({ db, clientId, fetchImpl: f, adoptedDb: null })
      const result = await hydrate({ db, gate, loop: probe, clientId, ...net, readOnly: true })
      const controls: SyncControls = { ...syncControlsDefaults, flush: async () => false }
      registerSyncControls(controls)
      return { result, loop: null, controls }
    }
    // C2: re-adopt (never post) whenever the server's database is not the one this browser adopted.
    let adopting: Promise<unknown> | null = null
    let suspended = false
    const readopt = () => {
      if (suspended) return
      adopting ??= hydrate({ db, gate, loop: loop!, clientId, ...net }).finally(() => { adopting = null })
    }
    loop = createSyncLoop({ db, clientId, ...net, ...(pollMs ? { pollMs } : {}), adoptedDb: await getSyncedDb(db), onMismatch: readopt })
    gate.onQueued = rows => loop?.queued(rows)
    // I-c: a restore in any tab pauses every tab; when it is done they all reload.
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null
    const send = (m: SyncMessage) => channel?.postMessage(m)
    const pause = () => { suspended = true; loop!.stop() }
    const resume = () => { suspended = false; loop!.start() }
    if (channel) {
      channel.onmessage = (e: MessageEvent<SyncMessage>) => {
        if (e.data?.type === 'restoring') { gate.readOnly = true; pause() }
        else if (e.data?.type === 'restore-cancelled') { gate.readOnly = false; resume() }
        else if (e.data?.type === 'restored') reload()
      }
    }
    const controls: SyncControls = {
      flush: () => (suspended ? Promise.resolve(false) : loop!.flush()),
      beginRestore: async () => {
        // G4 #3: from here on this tab refuses writes (the Read-only refusal), so nothing can be accepted
        // between the last flush and the swap and then silently wiped. Pending changes must land first.
        gate.readOnly = true
        if (!(await loop!.flush())) {
          gate.readOnly = false
          return null
        }
        await db._meta.put({ key: 'restoring', value: { fromDb: loop!.adoptedDb(), at: Date.now() } })
        pause()
        send({ type: 'restoring' })
        return async () => {
          await db._meta.delete('restoring')
          send({ type: 'restore-cancelled' })
          gate.readOnly = false
          resume()
        }
      },
      listRejected: () => loop!.listRejected(),
      retryRejected: () => loop!.retryRejected(),
      wipeLocal: async () => {
        // Never clear a working copy that is not synced to the server's database, or that holds
        // changes the server refused (they would be lost).
        // (A suspended restore is the exception: the server just swapped its database on purpose.)
        if (!suspended && !loop!.adoptedDb()) throw new Error('this browser is not synced to the Dojo database')
        if ((await loop!.listRejected()).length) throw new Error("some changes couldn't be saved")
        gate.bypass = true
        try {
          const mine = db.tables.filter(t => !t.name.startsWith('_'))
          await db.transaction('rw', [...mine, db._outbox, db._meta], async () => {
            for (const t of mine) await t.clear()
            await db._outbox.clear()
            await db._meta.delete('syncedDb') // this copy is synced to nothing now (the flag stays until re-hydrated)
          })
        } finally {
          gate.bypass = false
        }
        send({ type: 'restored' }) // every other tab reloads
      },
    }
    registerSyncControls(controls)
    adopting = hydrate({ db, gate, loop, clientId, ...net })
    const result = (await adopting) as HydrateResult
    adopting = null
    if (result === 'paused') pause() // another tab is restoring a backup; it will tell us to reload
    else loop.start() // also keeps polling, so "Not saved to disk" recovers once the server is back
    return { result, loop, controls }
  } catch (e) {
    console.warn('dojo: disk sync unavailable; running on browser storage only', e)
    setSaveState('offline')
    loop?.start()
    return { result: 'error', loop }
  }
}

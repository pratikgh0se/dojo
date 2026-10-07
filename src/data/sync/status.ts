// Tiny store for the header's save indicator. Lives in the entry chunk (it is a few hundred bytes);
// the sync code that drives it is a lazily loaded chunk.
import { useSyncExternalStore } from 'react'

/** off = disk sync not running (unit tests, previews): the indicator renders nothing. */
export type SaveState = 'off' | 'saved' | 'saving' | 'offline'

/** G4 #1: the server says this browser is not the writer (403 not_writer): retrying cannot help. */
export const NOT_WRITER_MESSAGE = 'Reopen Dojo from the Dojo app'

export const SAVE_LABEL: Record<Exclude<SaveState, 'off'>, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  offline: 'Not saved to disk',
}

let state: SaveState = 'off'
let reason = ''
const listeners = new Set<() => void>()

export function getSaveState(): SaveState {
  return state
}

/** Why the status is "Not saved to disk" (shown as the indicator's tooltip); empty otherwise. */
export function getSaveReason(): string {
  return reason
}

export function setSaveState(next: SaveState, why = ''): void {
  const r = next === 'offline' ? why : ''
  if (next === state && r === reason) return
  state = next
  reason = r
  for (const l of listeners) l()
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => { listeners.delete(l) }
}

export function useSaveState(): SaveState {
  return useSyncExternalStore(subscribe, getSaveState, getSaveState)
}

export function useSaveReason(): string {
  return useSyncExternalStore(subscribe, getSaveReason, getSaveReason)
}

// I2: how many changes the server refused (parked in _meta.rejectedOps until retried).
let rejected = 0
export function getRejectedCount(): number {
  return rejected
}
export function setRejectedCount(n: number): void {
  if (n === rejected) return
  rejected = n
  for (const l of listeners) l()
}
export function useRejectedCount(): number {
  return useSyncExternalStore(subscribe, getRejectedCount, getRejectedCount)
}
export const rejectedLabel = (n: number) => `${n} change${n === 1 ? '' : 's'} couldn't be saved`

/** A change the server refused, as Settings lists it. */
export interface RejectedOp { opId: string; tbl: string; op: string; id?: string; at: string; error?: string }

/** What the UI may ask of the sync layer. Registered by data/sync/boot; no-ops when sync is off. */
export interface SyncControls {
  /** Push every pending change to the server now. */
  flush(): Promise<boolean>
  /** Empty the local working copy (no ops emitted) so the next boot re-hydrates from the server. */
  wipeLocal(): Promise<void>
  /** The changes the server refused (I2). */
  listRejected(): Promise<RejectedOp[]>
  /** Queue the refused changes again and send them. */
  retryRejected(): Promise<boolean>
  /**
   * I-c: before POST /db/restore. Marks the shared browser database as restoring (_meta.restoring) and
   * tells every Dojo tab (BroadcastChannel) to stop syncing, so none of them merges its pre-restore
   * copy into the restored database. Every tab refuses writes meanwhile (G4 #3). Resolves to cancel(),
   * for a restore that did not happen, or to null when pending changes could not be saved first.
   */
  beginRestore(): Promise<(() => Promise<void>) | null>
}
export const syncControlsDefaults: SyncControls = {
  flush: async () => true, wipeLocal: async () => {}, listRejected: async () => [], retryRejected: async () => true,
  beginRestore: async () => async () => {},
}
export const syncControls: SyncControls = { ...syncControlsDefaults }
export function registerSyncControls(c: Partial<SyncControls>): void {
  Object.assign(syncControls, c)
}

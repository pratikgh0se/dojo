import type { SqliteAdapter } from './adapter.mjs'
import type { Store } from './store.mjs'
export const KEEP_DATED_BACKUPS: number
export function localDate(d: Date): string
export interface BackupInfo { file: string; bytes: number; at: string }
export function ensureWriterToken(home: string): string
export interface Dojo {
  writerToken: string
  home: string
  dbPath: string
  store: Store
  adapter: SqliteAdapter
  listBackups(): BackupInfo[]
  backup(manual?: boolean): { ok: true; file: string; bytes: number }
  backupNow(): { ok: true; file: string; bytes: number }
  ensureTodaysBackup(): { ok: true; file: string; bytes: number } | null
  restore(file: string): { ok: true; restored: string; preRestore: string }
  health(): ReturnType<Store['health']>
  startBackupTimer(ms?: number): void
  close(): void
}
export function openDojo(opts: { home: string; clock?: () => Date; hooks?: { beforeSwap?(): void; afterSwap?(): void } }): Dojo

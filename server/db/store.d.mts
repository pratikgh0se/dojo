import type { SqliteAdapter } from './adapter.mjs'
export class DbError extends Error { status: number; code: string }
export interface Store {
  health(lastBackup?: string | null): { ok: true; dbPath: string; dbId: string; docs: number; ops: number; lastBackup: string | null }
  state(): { tables: Record<string, unknown[]> }
  applyOps(body: unknown): { ok: true; applied: number; seq: number }
}
export function createStore(getAdapter: () => SqliteAdapter, now?: () => string): Store
export const APPEND_ONLY: Set<string>

export class SqliteAdapter {
  constructor(path: string, opts?: { readOnly?: boolean })
  path: string
  exec(sql: string): void
  all(sql: string, ...params: unknown[]): Record<string, any>[]
  get(sql: string, ...params: unknown[]): Record<string, any> | undefined
  run(sql: string, ...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint }
  transaction<T>(fn: (a: SqliteAdapter) => T): T
  backupTo(file: string): void
  close(): void
}
export const MIGRATIONS_DIR: string
export function openSqlite(path: string, opts?: { readOnly?: boolean }): SqliteAdapter
export function runMigrations(adapter: SqliteAdapter, dir?: string, now?: () => string): string[]
export function ensureDbId(adapter: SqliteAdapter, opts?: { rotate?: boolean }): string

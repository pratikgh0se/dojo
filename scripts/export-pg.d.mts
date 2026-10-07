import type { SqliteAdapter } from '../server/db/adapter.mjs'
export function pgMigrations(dir?: string): string
export function buildDump(adapter: SqliteAdapter, now?: () => string): { sql: string; counts: Record<string, number>; warnings: string[] }
export function exportPg(o: { home: string; now?: () => Date }): { file: string; counts: Record<string, number>; warnings: string[] }

import type { OutboxRow } from '../src/data/db'
import { toOp } from '../src/data/sync/loop'

/** The server refuses an ops request over 5 MB; a migration group goes in one request, so flag it above 4 MB. */
export const GROUP_LIMIT_BYTES = 4_000_000
export const GROUP_LIMIT_NAME = "migration group within the server's 5 MB ops limit"
export const GROUP_LIMIT_MESSAGE = "migration group exceeds the server's 5 MB ops limit"

export interface GroupSize { rows: number; bytes: number }

/** Rows of the migration group (outbox rows with a `grp`) and the byte length of the JSON the sync loop would send for them. */
export function groupSize(outbox: OutboxRow[]): GroupSize {
  const grouped = outbox.filter(r => r.grp)
  return { rows: grouped.length, bytes: new TextEncoder().encode(JSON.stringify(grouped.map(toOp))).length }
}

export function groupSizeResult(g: GroupSize): { name: string; ok: boolean; detail: string } {
  return g.bytes > GROUP_LIMIT_BYTES
    ? { name: GROUP_LIMIT_NAME, ok: false, detail: GROUP_LIMIT_MESSAGE }
    : { name: GROUP_LIMIT_NAME, ok: true, detail: `${g.rows} rows, ${g.bytes} bytes` }
}

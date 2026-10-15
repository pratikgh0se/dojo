import type { DojoDB } from './db'
import { moveInLane } from '../rules/queue'

export type ReorderResult = { ok: true; patched: number } | { ok: false; message: string }

/** Dragging inside a lane: sets `orderOverride` only (never `order`, never the status). */
export async function reorderInLane(d: DojoDB, id: string, toIndex: number): Promise<ReorderResult> {
  return d.transaction('rw', d.tickets, async (): Promise<ReorderResult> => {
    const all = await d.tickets.toArray()
    const t = all.find(x => x.id === id)
    if (!t || t.archived) return { ok: false, message: 'Ticket not found' }
    if (t.status === 'done') return { ok: false, message: 'A finished ticket stays where it is' }
    const patches = moveInLane(all, id, toIndex)
    for (const p of patches) {
      const row = all.find(x => x.id === p.id)!
      await d.tickets.put({ ...row, orderOverride: p.orderOverride })
    }
    return { ok: true, patched: patches.length }
  })
}

export async function clearOrderOverride(d: DojoDB, id: string): Promise<void> {
  await d.transaction('rw', d.tickets, async () => {
    const t = await d.tickets.get(id)
    if (!t || t.orderOverride === undefined) return
    const { orderOverride: _o, ...rest } = t
    await d.tickets.put(rest)
  })
}

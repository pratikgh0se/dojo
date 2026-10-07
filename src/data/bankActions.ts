import type { ClassifyOutput } from '../ai/types'
import type { AtlasPattern } from '../content/patterns'
import type { BankTabId } from '../content/banks/meta'
import { MOVE_MESSAGES } from '../rules/board'
import type { ItemView } from '../rules/banks'
import { bankTicket } from '../rules/bankTickets'
import { ladderRow, splitLadder, type LadderItem } from '../rules/cfLadder'
import { MINE_DUPLICATE, type MineSource } from '../rules/mine'
import { moveTicket, type ActionResult } from './boardActions'
import type { DojoDB } from './db'
import type { BankItem, Difficulty } from './types'

/**
 * C-BANKS §2. In-plan items tick the one plan ticket through moveTicket (plan progress moves).
 * Bank-only items: first tick creates a done ticket; untick deletes it.
 *
 * Ticks and looks up by `item.ticketId`, not `item.id`: contract DECISION 9 makes two rows
 * that carry the same LeetCode number (e.g. a Striver traversal variant and its canonical
 * row) share one ticket keyed `p<num>`, even though each row keeps its own `id`.
 */
export async function toggleBankItem(d: DojoDB, item: ItemView, bank: BankTabId, nowMs: number, sprint: number): Promise<ActionResult> {
  if (item.plan) {
    const t = await d.tickets.get(item.plan.ticketId)
    if (!t || t.archived) return { ok: false, reason: 'missing', message: MOVE_MESSAGES.missing }
    return moveTicket(d, t.id, t.status === 'done' ? 'todo' : 'done', nowMs)
  }
  return d.transaction('rw', d.tickets, d.events, async (): Promise<ActionResult> => {
    const t = await d.tickets.get(item.ticketId)
    if (t && !t.archived && t.status === 'done') {
      await d.tickets.delete(t.id)
      await d.events.add({ t: 'untick', id: t.id, at: nowMs })
      return { ok: true, xpDelta: -t.xp }
    }
    const next = bankTicket({ ...item, id: item.ticketId }, bank, nowMs, sprint)
    await d.tickets.put(next)
    await d.events.add({ t: 'tick', id: next.id, at: nowMs, xp: next.xp })
    return { ok: true, xpDelta: next.xp }
  })
}

export interface MineDraft {
  key: string
  name: string
  url: string | null
  num?: number
  pattern: AtlasPattern | null
  difficulty: Difficulty
  /** A known Codeforces item's rating, so ticking it from Mine pays the same XP as Codeforces. */
  rating?: number
  source: MineSource
  input: string
  ticketId: string
  classify?: ClassifyOutput
}

export type MineResult = { ok: true } | { ok: false; message: string }

export const MINE_REMOVE_DONE = 'Untick it before removing it'

export async function addMineItem(d: DojoDB, draft: MineDraft, nowMs: number): Promise<MineResult> {
  return d.transaction('rw', d.bankItems, async (): Promise<MineResult> => {
    const id = `mine:${draft.key}`
    if (await d.bankItems.get(id)) return { ok: false, message: MINE_DUPLICATE }
    const row: BankItem = {
      id, bank: 'mine', key: draft.key, name: draft.name, pattern: draft.pattern, difficulty: draft.difficulty,
      status: 'todo', ticketId: draft.ticketId, addedAt: nowMs, input: draft.input,
      inputKind: draft.url ? 'url' : 'text', source: draft.source,
    }
    if (draft.url) row.url = draft.url
    if (draft.num !== undefined) row.num = draft.num
    if (draft.rating !== undefined) row.rating = draft.rating
    if (draft.classify) {
      row.classify = draft.classify
      row.classifiedAt = nowMs
    }
    await d.bankItems.put(row)
    return { ok: true }
  })
}

export async function updateMineItem(
  d: DojoDB, rowId: string, patch: { name: string; pattern: AtlasPattern | null; difficulty: Difficulty },
): Promise<MineResult> {
  const n = await d.bankItems.update(rowId, patch)
  return n === 1 ? { ok: true } : { ok: false, message: 'Not found' }
}

export async function removeMineItem(d: DojoDB, rowId: string): Promise<MineResult> {
  return d.transaction('rw', d.bankItems, d.tickets, async (): Promise<MineResult> => {
    const row = await d.bankItems.get(rowId)
    if (!row) return { ok: false, message: 'Not found' }
    const t = await d.tickets.get(row.ticketId ?? row.key)
    if (t && !t.archived && t.status === 'done') return { ok: false, message: MINE_REMOVE_DONE }
    await d.bankItems.delete(rowId)
    return { ok: true }
  })
}

export async function importLadder(
  d: DojoDB, items: LadderItem[], existingIds: ReadonlySet<string>, nowMs: number,
): Promise<{ added: number; present: number }> {
  return d.transaction('rw', d.bankItems, async () => {
    const stored = new Set((await d.bankItems.where('bank').equals('codeforces').toArray()).map(r => r.key))
    const { fresh, present } = splitLadder(items, new Set([...existingIds, ...stored]))
    if (fresh.length) await d.bankItems.bulkPut(fresh.map(x => ladderRow(x, nowMs)))
    return { added: fresh.length, present }
  })
}

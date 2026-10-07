import type { DojoDB } from './db'
import type { Ticket } from './types'
import { canSplit, containerState, splitTicket } from '../rules/split'
import { now as clockNow } from '../lib/clock'
import { stamp } from './undoSession'

export type SplitOutcome = { ok: true; children: Ticket[] } | { ok: false; message: string }

/**
 * Splitting hands out fresh XP to fresh cards, so a card that was already worked (help rungs used, or an
 * attempt cycle open: `openCycle`, which only the browser knows) cannot be split: help would be forgotten.
 */
export async function splitIntoSessions(
  d: DojoDB, id: string, parts: number, titles: readonly string[] = [], opts: { openCycle?: boolean; now?: number } = {},
): Promise<SplitOutcome> {
  return d.transaction('rw', [d.tickets, d.rungUses, d.redos, d.checkAttempts, d.events], async (): Promise<SplitOutcome> => {
    const t = await d.tickets.get(id)
    if (!t) return { ok: false, message: 'Ticket not found' }
    const check = canSplit(t, parts)
    if (!check.ok) return check
    if ((await d.redos.where('ticketId').equals(id).toArray()).some(r => r.closedAt === undefined)) return { ok: false, message: 'A card with a redo waiting cannot be split' }
    if ((await d.checkAttempts.where('ticketId').equals(id).toArray()).some(a => !a.passed)) return { ok: false, message: 'A card with a failed check cannot be split' }
    if (opts.openCycle || (await d.rungUses.where('ticketId').equals(id).count()) > 0) return { ok: false, message: 'A card you already took help on cannot be split' }
    const r = splitTicket(t, parts, titles)
    await d.tickets.bulkPut([r.parent, ...r.children])
    // ruling 20 S6: undoable in this session while no part has been started
    await d.events.add(stamp({ t: 'split', id, at: opts.now ?? clockNow(), parts: r.children.map(c => c.id) }))
    return { ok: true, children: r.children }
  })
}

/**
 * Keeps a container in step with its sessions: done once all of them are (no XP of its own: the
 * sessions earn theirs through netOf), open again when one is reopened. Call inside a transaction
 * that includes `d.tickets`, right after a session's status changed.
 */
export async function syncParentOf(d: DojoDB, ticketId: string, now: number): Promise<void> {
  const t = await d.tickets.get(ticketId)
  if (!t?.childOf) return
  const parent = await d.tickets.get(t.childOf)
  if (!parent?.children?.length) return
  const kids = (await d.tickets.bulkGet(parent.children)).filter((c): c is Ticket => c !== undefined)
  const next = containerState(parent, kids, now)
  if (next) await d.tickets.put(next)
}

/** Ruling 20 S6: a part counts as started once it left Todo, earned or lost XP, or took help. */
export const partStarted = (t: Ticket): boolean => t.status !== 'todo' || t.xp !== 0 || !!t.deepestRung

/** Every part still exists and none has been started: the split can be undone. */
export function partsUnstarted(tickets: readonly Ticket[], ids: readonly string[]): boolean {
  const byId = new Map(tickets.map(t => [t.id, t]))
  return ids.every(id => { const p = byId.get(id); return !!p && !p.archived && !partStarted(p) })
}

/** Undoes a split: removes the parts and makes the parent whole. False when a part was started (nothing changes). */
export async function undoSplit(d: DojoDB, parentId: string, ids: readonly string[]): Promise<boolean> {
  const parent = await d.tickets.get(parentId)
  const parts = (await d.tickets.bulkGet([...ids])).filter((t): t is Ticket => t !== undefined)
  if (!parent || !partsUnstarted(parts, ids)) return false
  await d.tickets.bulkDelete([...ids])
  const { children: _c, ...whole } = parent
  await d.tickets.put(whole)
  return true
}

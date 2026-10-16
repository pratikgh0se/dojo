import type { DojoDB } from './db'
import type { Ticket } from './types'
import { canMove, MOVE_MESSAGES, type Column } from '../rules/board'
import { isBankOrigin } from '../rules/bankTickets'
import { netOf } from './ladderActions'

export type ActionResult = { ok: true; xpDelta: number; count?: number } | { ok: false; reason: string; message: string }

const fail = (reason: string, message: string): ActionResult => ({ ok: false, reason, message })

async function moveTicketInner(d: DojoDB, id: string, to: Column, now: number): Promise<ActionResult> {
  // rungUses is needed by netOf (I2: Board's Done move uses the same one XP function as the
  // ladder, so give-up → Solution → Board-done charges the net, not the ticket's full base).
  return d.transaction('rw', d.tickets, d.events, d.rungUses, async (): Promise<ActionResult> => {
    const all = await d.tickets.toArray()
    const own = all.find(x => x.id === id)
    // C-BANKS §2: a bank ticket exists only while done. Leaving Done deletes it (an untick).
    // An unknown/missing origin is not a bank ticket, so it behaves like 'plan' here.
    if (own && !own.archived && isBankOrigin(own.origin) && own.status === 'done' && to !== 'done') {
      await d.tickets.delete(id)
      await d.events.add({ t: 'untick', id, at: now })
      return { ok: true, xpDelta: -own.xp }
    }
    const check = canMove(all, id, to)
    if (!check.ok) return fail(check.reason, MOVE_MESSAGES[check.reason])
    const t = all.find(x => x.id === id)!

    // A Done ticket moving to any non-Done status (Doing or Todo) must first pay back
    // its XP: zero it, drop doneAt/doneAtApprox, and record one untick event — before
    // landing on the target status. Without this, a Done→Doing→Done round trip leaks XP.
    if (to !== 'done' && t.status === 'done') {
      const oldXp = t.xp
      const next: Ticket = { ...t, status: to, xp: 0 }
      delete next.doneAt
      delete next.doneAtApprox
      delete next.blockedNote
      await d.tickets.put(next)
      await d.events.add({ t: 'untick', id, at: now })
      return { ok: true, xpDelta: -oldXp }
    }

    // README Data fields: `blockedNote` belongs to a blocked or need-help ticket only. Moving between those two keeps it; any other move removes it.
    const { blockedNote: note, ...bare } = t
    if (to === 'blocked' || to === 'help') {
      const keep = (t.status === 'blocked' || t.status === 'help') && note ? { blockedNote: note } : {}
      await d.tickets.put({ ...bare, status: to, ...keep })
      return { ok: true, xpDelta: 0 }
    }
    if (to === 'doing') {
      await d.tickets.put({ ...bare, status: 'doing' })
      return { ok: true, xpDelta: 0 }
    }
    if (to === 'done') {
      const next: Ticket = { ...bare, status: 'done', doneAt: now, doneAtApprox: false }
      const xp = await netOf(d, next)
      await d.tickets.put({ ...next, xp })
      await d.events.add({ t: 'tick', id, at: now, xp })
      return { ok: true, xpDelta: xp - t.xp }
    }
    await d.tickets.put({ ...bare, status: 'todo' })
    return { ok: true, xpDelta: 0 }
  })
}

export async function moveTicket(d: DojoDB, id: string, to: Column, now: number): Promise<ActionResult> {
  return d.transaction('rw', d.tickets, d.events, d.rungUses, () => moveTicketInner(d, id, to, now))
}

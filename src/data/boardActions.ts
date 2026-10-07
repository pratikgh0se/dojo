import type { DojoDB } from './db'
import type { Ticket } from './types'
import { needsCheck } from '../rules/brief'
import { canMove, MOVE_MESSAGES, type Column } from '../rules/board'
import { isBankOrigin } from '../rules/bankTickets'
import {
  nextSlideTarget, shiftPlan, SLIDE_MESSAGES, slideSprint, slideTicket, undoableSteps, undoEvent, type SlideLikeEvent,
} from '../rules/slide'
import { netOf } from './ladderActions'
import { partsUnstarted, syncParentOf, undoSplit } from './splitActions'
import { APP_SESSION, stamp } from './undoSession'

export type ActionResult = { ok: true; xpDelta: number; count?: number } | { ok: false; reason: string; message: string }

const fail = (reason: string, message: string): ActionResult => ({ ok: false, reason, message })

async function moveTicketInner(d: DojoDB, id: string, to: Column, now: number, skipCheck = false): Promise<ActionResult> {
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
    if (to === 'done' && !skipCheck && needsCheck(t)) return fail('check_required', MOVE_MESSAGES.check_required)

    // A Done ticket moving to any non-Done status (Doing or Todo) must first pay back
    // its XP: zero it, drop doneAt/doneAtApprox, and record one untick event — before
    // landing on the target status. Without this, a Done→Doing→Done round trip leaks XP.
    if (to !== 'done' && t.status === 'done') {
      const oldXp = t.xp
      const next: Ticket = { ...t, status: to, xp: 0 }
      delete next.doneAt
      delete next.doneAtApprox
      await d.tickets.put(next)
      await d.events.add({ t: 'untick', id, at: now })
      return { ok: true, xpDelta: -oldXp }
    }

    if (to === 'doing') {
      await d.tickets.put({ ...t, status: 'doing' })
      return { ok: true, xpDelta: 0 }
    }
    if (to === 'done') {
      const next: Ticket = { ...t, status: 'done', doneAt: now, doneAtApprox: false }
      const xp = await netOf(d, next)
      await d.tickets.put({ ...next, xp })
      await d.events.add({ t: 'tick', id, at: now, xp })
      return { ok: true, xpDelta: xp - t.xp }
    }
    await d.tickets.put({ ...t, status: 'todo' })
    return { ok: true, xpDelta: 0 }
  })
}

/** `skipCheck` is only for submitCheck: a passed check is the one way to finish a learning card. */
export async function moveTicket(d: DojoDB, id: string, to: Column, now: number, skipCheck = false): Promise<ActionResult> {
  return d.transaction('rw', d.tickets, d.events, d.rungUses, async (): Promise<ActionResult> => {
    const r = await moveTicketInner(d, id, to, now, skipCheck)
    if (r.ok) await syncParentOf(d, id, now)
    return r
  })
}

async function slideOne(d: DojoDB, id: string, pickTo: (t: Ticket) => number, now: number, current: number): Promise<ActionResult> {
  return d.transaction('rw', d.tickets, d.events, async (): Promise<ActionResult> => {
    const t = await d.tickets.get(id)
    if (!t || t.archived) return fail('missing', MOVE_MESSAGES.missing)
    const r = slideTicket(t, pickTo(t), now, current)
    if (!r.ok) return fail(r.reason, SLIDE_MESSAGES[r.reason])
    await d.tickets.put(r.ticket)
    await d.events.add(stamp(r.event))
    return { ok: true, xpDelta: 0 }
  })
}

export function slideTicketTo(d: DojoDB, id: string, to: number, now: number, current: number): Promise<ActionResult> {
  return slideOne(d, id, () => to, now, current)
}

export function slideNext(d: DojoDB, id: string, now: number, current: number): Promise<ActionResult> {
  return slideOne(d, id, t => nextSlideTarget(t, current), now, current)
}

export async function slideSprintAction(d: DojoDB, sprint: number, now: number, current: number): Promise<ActionResult> {
  return d.transaction('rw', d.tickets, d.events, async (): Promise<ActionResult> => {
    const r = slideSprint(await d.tickets.toArray(), sprint, now, current)
    if (r.tickets.length === 0) return fail('empty', `Nothing to slide in S${sprint}`)
    await d.tickets.bulkPut(r.tickets)
    await d.events.add(stamp(r.event))
    return { ok: true, xpDelta: 0, count: r.tickets.length }
  })
}

export async function shiftPlanAction(d: DojoDB, fromSprint: number, now: number, current: number): Promise<ActionResult> {
  const from = Math.max(fromSprint, current)
  return d.transaction('rw', d.tickets, d.events, async (): Promise<ActionResult> => {
    const r = shiftPlan(await d.tickets.toArray(), from, now)
    if (r.tickets.length === 0) return fail('empty', `Nothing to shift from S${from}`)
    await d.tickets.bulkPut(r.tickets)
    await d.events.add(stamp(r.event))
    return { ok: true, xpDelta: 0, count: r.tickets.length }
  })
}

/**
 * UAT r3 J7: a Board column move (drag, Shift+arrow, the d key) as one undoable step. The move itself is moveTicket's
 * (XP, ticks, the Doing limit, split parents); a `column` event records where the card came from.
 */
export async function moveOnBoard(d: DojoDB, id: string, to: Column, now: number): Promise<ActionResult> {
  return d.transaction('rw', d.tickets, d.events, d.rungUses, async (): Promise<ActionResult> => {
    const before = await d.tickets.get(id)
    const r = await moveTicket(d, id, to, now)
    if (!r.ok || !before) return r
    const after = await d.tickets.get(id) // a bank ticket leaving Done is gone: that untick is not undoable
    if (after && after.status !== before.status) await d.events.add(stamp({ t: 'column', id, at: now, from: before.status, to: after.status }))
    return r
  })
}

const columnFor = (s: Ticket['status']): Column => (s === 'done' ? 'done' : s === 'doing' ? 'doing' : 'todo')

/** Ruling 20 S6: this session's undo steps, newest first; a split whose parts were started is no longer one. */
export async function undoSteps(d: DojoDB): Promise<SlideLikeEvent[][]> {
  const tickets = await d.tickets.toArray()
  return undoableSteps(await d.events.toArray(), { appSession: APP_SESSION, blocked: e => e.t === 'split' && !partsUnstarted(tickets, e.parts) })
}

export async function undoLast(d: DojoDB, now: number): Promise<ActionResult> {
  return d.transaction('rw', d.tickets, d.events, d.rungUses, async (): Promise<ActionResult> => {
    const steps = await undoSteps(d)
    if (steps.length === 0) return fail('nothing', 'Nothing to undo')
    const head = steps[0][0]
    if (head.t === 'split') {
      // ruling 20 S6: the parts go and the parent is whole again (only while no part has been started)
      const undone = await undoSplit(d, head.id, head.parts)
      await d.events.add({ t: 'undo', at: now, of: head.seq as number })
      return { ok: true, xpDelta: 0, count: undone ? 1 : 0 }
    }
    if (head.t === 'column') {
      // the card goes back the way it came, through the same move (Done gives its XP back, or gets it again)
      const t = await d.tickets.get(head.id)
      let xpDelta = 0
      if (t && !t.archived && t.status === head.to) {
        const r = await moveTicketInner(d, head.id, columnFor(head.from), now, true)
        if (!r.ok) return r
        await syncParentOf(d, head.id, now)
        xpDelta = r.xpDelta
      }
      await d.events.add({ t: 'undo', at: now, of: head.seq as number })
      return { ok: true, xpDelta, count: 1 }
    }
    // UAT J7: a step is one user action; a moved step holds one event per card it moved.
    const tickets = await d.tickets.toArray()
    const patched = steps[0].flatMap(ev => undoEvent(tickets, ev))
    if (patched.length) await d.tickets.bulkPut(patched)
    for (const ev of steps[0]) await d.events.add({ t: 'undo', at: now, of: ev.seq as number })
    return { ok: true, xpDelta: 0, count: patched.length }
  })
}

/** Ask what to slide → Slide these (C-LADDER H-41): one slide event per ticket, done tickets skipped. */
export async function slideTicketsTo(d: DojoDB, ids: string[], to: number, now: number, current: number): Promise<ActionResult> {
  return d.transaction('rw', d.tickets, d.events, async (): Promise<ActionResult> => {
    let count = 0
    for (const id of ids) {
      const t = await d.tickets.get(id)
      if (!t || t.archived) continue
      const r = slideTicket(t, to, now, current)
      if (!r.ok) continue
      await d.tickets.put(r.ticket)
      await d.events.add(stamp(r.event))
      count++
    }
    return count === 0 ? fail('empty', 'Nothing to slide') : { ok: true, xpDelta: 0, count }
  })
}

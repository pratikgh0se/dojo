// Ruling 20 S4: the units every counter uses once a card is split. Pure.
//   Time and workload (minutes, load, the sprint clock) count the open parts, never the parent.
//   Problem and progress counts (solved, evidence, n/total, XP per BR-19) count the PARENT once, when all its parts
//   are done. Parts are never counted as items of their own.
import type { Outcome, Session, Ticket } from '../data/types'

/** A session split off a big card (BR-08). It carries time, never a count. */
export const isPart = (t: Pick<Ticket, 'childOf'>): boolean => t.childOf !== undefined

/** The item a ticket counts as: a part counts as its parent. */
export const itemIdOf = (t: Pick<Ticket, 'id' | 'childOf'>): string => t.childOf ?? t.id

/** The tickets that are counted as items: every ticket but the parts of a split card. */
export function countedItems<T extends Pick<Ticket, 'childOf'>>(tickets: readonly T[]): T[] {
  return tickets.filter(t => !isPart(t))
}

/** Help on any part makes the whole solved with help; otherwise one solved part makes it solved. */
const WORST: Record<Outcome, number> = { studied: 0, gave_up: 1, solved: 2, solved_help: 3 }

/**
 * Sessions as item evidence (Progress → Evidence, the outcomes and help-ladder charts). A part's sessions don't count
 * on their own. Once the split card is done (all its parts are), they count as ONE session of the parent: at the last
 * part's time, with every rung any part opened, and the outcome over the parts' latest sessions (help on any part →
 * solved with help). While the card is still open, its parts' sessions count nowhere. Other sessions pass through.
 */
export function itemSessions(sessions: readonly Session[], tickets: readonly Ticket[]): Session[] {
  const byId = new Map(tickets.map(t => [t.id, t]))
  const out: Session[] = []
  const parts = new Map<string, Session[]>()
  for (const s of sessions) {
    const parent = byId.get(s.ticketId)?.childOf
    if (parent === undefined) {
      out.push(s)
      continue
    }
    const list = parts.get(parent) ?? []
    list.push(s)
    parts.set(parent, list)
  }
  for (const [pid, list] of parts) {
    const parent = byId.get(pid)
    if (!parent || parent.archived || parent.status !== 'done') continue
    const counted = list.filter(s => s.outcome !== 'studied')
    if (counted.length === 0) continue
    const latest = new Map<string, Session>()
    for (const s of counted) {
      const cur = latest.get(s.ticketId)
      if (!cur || s.end > cur.end || (s.end === cur.end && s.start > cur.start)) latest.set(s.ticketId, s)
    }
    const outcome = [...latest.values()].reduce<Outcome>((a, s) => (WORST[s.outcome] > WORST[a] ? s.outcome : a), 'studied')
    const last = counted.reduce((a, s) => (s.end > a.end || (s.end === a.end && s.start > a.start) ? s : a))
    const rungs = [...new Set(counted.flatMap(s => s.rungs ?? []))].sort((a, b) => a - b)
    out.push({
      id: `${pid}#parts`,
      ticketId: pid,
      start: last.start,
      end: last.end,
      minutes: counted.reduce((a, s) => a + s.minutes, 0),
      outcome,
      xpDelta: counted.reduce((a, s) => a + s.xpDelta, 0),
      ...(rungs.length ? { rungs } : {}),
    })
  }
  return out
}

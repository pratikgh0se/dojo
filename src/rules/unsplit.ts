import type { Redo, Rung, Status, Ticket } from '../data/types'
import { localDayKey } from '../lib/dates'
import type { FlatState } from './flatState'
import { dueMs } from './redoQueue'
import { idMapOfPairs, remapRows } from './remapIds'

type Legacy = { children?: string[]; childOf?: string; checkPassedAt?: number; xpBase?: number }
const L = (t: Ticket): Ticket & Legacy => t as Ticket & Legacy
const kids = (t: Ticket): string[] => L(t).children ?? []

/** Contract MIG-07: done when all parts are done; doing when any part is doing or some (not all) are done; else todo. */
export function promotedStatus(parts: Pick<Ticket, 'status'>[]): Status | null {
  if (parts.length === 0) return null
  if (parts.every(p => p.status === 'done')) return 'done'
  if (parts.some(p => p.status === 'doing' || p.status === 'done')) return 'doing'
  return 'todo'
}

const dueDay = (r: Redo): string => localDayKey(dueMs(r.due))

function strip(t: Ticket): Ticket {
  const { children: _c, childOf: _o, checkPassedAt: _k, xpBase: _x, ...rest } = L(t)
  return rest as Ticket
}

export interface UnsplitReport {
  containers: number; promoted: number; dropped: number; partsFolded: number; redosMerged: number
  collisions: { code: number; pictures: number }
}

export function unsplit(state: FlatState, planIds: ReadonlySet<string>, now: number): { state: FlatState; report: UnsplitReport; folded: Map<string, string> } {
  const byId = new Map(state.tickets.map(t => [t.id, t]))
  const containers = state.tickets.filter(t => kids(t).length > 0)
  const containerIds = new Set(containers.map(c => c.id))
  const partsOf = new Map<string, Ticket[]>()
  const add = (cid: string, t: Ticket) => { const l = partsOf.get(cid) ?? []; if (!l.includes(t)) l.push(t); partsOf.set(cid, l) }
  for (const t of state.tickets) { const p = L(t).childOf; if (p !== undefined && containerIds.has(p)) add(p, t) }
  for (const c of containers) for (const id of kids(c)) { const t = byId.get(id); if (t) add(c.id, t) }

  const next = new Map(state.tickets.map(t => [t.id, t]))
  const pairs: { from: string; to: string }[] = []
  const folded = new Map<string, string>()
  let promoted = 0
  let dropped = 0

  for (const c of containers) {
    const parts = (partsOf.get(c.id) ?? []).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    if (planIds.has(c.id)) {
      promoted++
      const live = parts.filter(p => !p.archived)
      const status = promotedStatus(live) ?? c.status
      const doneAts = live.filter(p => p.status === 'done' && p.doneAt !== undefined).map(p => p.doneAt as number)
      const merged: Ticket = { ...strip(c), status, xp: c.xp + parts.reduce((s, p) => s + p.xp, 0), archived: false }
      delete merged.doneAt
      delete merged.doneAtApprox
      if (status === 'done') {
        const at = doneAts.length ? Math.max(...doneAts) : c.doneAt
        if (at !== undefined) merged.doneAt = at
      }
      const rung = Math.max(c.deepestRung ?? 0, ...parts.map(p => p.deepestRung ?? 0)) as 0 | Rung
      if (rung > 0) merged.deepestRung = rung
      if (!merged.deliverable) {
        const newest = parts.filter(p => p.deliverable).sort((a, b) => (b.deliverable?.at ?? 0) - (a.deliverable?.at ?? 0))[0]
        if (newest?.deliverable) merged.deliverable = newest.deliverable
      }
      next.set(c.id, merged)
      for (const p of parts) {
        next.set(p.id, { ...strip(p), archived: true, xp: 0, mergedInto: c.id, origin: 'plan' })
        pairs.push({ from: p.id, to: c.id })
        folded.set(p.id, c.id)
      }
    } else {
      dropped++
      next.set(c.id, { ...strip(c), archived: true })
      for (const p of parts) next.set(p.id, { ...strip(p), archived: true })
    }
  }
  for (const t of state.tickets) {
    const p = L(t).childOf
    if (p !== undefined && !containerIds.has(p)) next.set(t.id, { ...strip(t), archived: true })
  }

  const { rows, collisions } = remapRows(
    { sessions: state.sessions, redos: state.redos, rungUses: state.rungUses, checkAttempts: state.checkAttempts, code: state.code,
      grades: state.grades, bankItems: state.bankItems, designSessions: state.designSessions, events: state.events, aiLog: state.aiLog, pictures: state.pictures },
    idMapOfPairs(pairs),
  )

  // one live redo per ticket: after the move, the oldest due (due day, then createdAt, then id) stays open
  const targets = new Set(pairs.map(p => p.to))
  const live = new Map<string, Redo[]>()
  for (const r of rows.redos) if (r.closedAt === undefined && targets.has(r.ticketId)) live.set(r.ticketId, [...(live.get(r.ticketId) ?? []), r])
  const close = new Set<string>()
  for (const list of live.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => dueDay(a).localeCompare(dueDay(b)) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(1).forEach(r => close.add(r.id))
  }
  const redos = rows.redos.map(r => (close.has(r.id) ? { ...r, closedAt: now } : r))

  return {
    state: { ...state, ...rows, redos, tickets: state.tickets.map(t => next.get(t.id) as Ticket) },
    report: { containers: containers.length, promoted, dropped, partsFolded: pairs.length, redosMerged: close.size, collisions },
    folded,
  }
}

import type { Status, Ticket } from '../data/types'
import { isBankOrigin } from './bankTickets'
import { CONTENT_KEYS, newTicket, type PlanTicketContent } from './planTickets'

export interface ReconcileResult {
  puts: Ticket[]
  deletes: string[]
  renames: Array<{ from: string; to: string }>
  inserted: string[]
  archived: string[]
}

export function resolveId(id: string, idMap: Record<string, string>, isLive: (id: string) => boolean): string | null {
  const seen = new Set<string>([id])
  let cur = id
  while (Object.prototype.hasOwnProperty.call(idMap, cur)) {
    const next = idMap[cur]
    if (seen.has(next)) return null
    seen.add(next)
    if (isLive(next)) return next
    cur = next
  }
  return null
}

function withContent(t: Ticket, c: PlanTicketContent): Ticket {
  const base: Partial<Ticket> = { ...t }
  for (const k of CONTENT_KEYS) delete base[k]
  return { ...(base as Ticket), ...c, archived: false }
}

const STATUS_RANK: Record<Status, number> = { done: 3, doing: 2, slid: 1, todo: 0 }

/** First non-undefined value for each proof slot, in row order; slot objects are cloned, never shared. */
function mergeProof(rows: Ticket[]): Ticket['proof'] | undefined {
  const proofs = rows.map(r => r.proof).filter((p): p is NonNullable<Ticket['proof']> => p !== undefined)
  if (proofs.length === 0) return undefined
  const out: NonNullable<Ticket['proof']> = {}
  const repo = proofs.find(p => p.repo !== undefined)?.repo
  const note = proofs.find(p => p.note !== undefined)?.note
  const built = proofs.find(p => p.built !== undefined)?.built
  const proven = proofs.find(p => p.proven !== undefined)?.proven
  const understood = proofs.find(p => p.understood !== undefined)?.understood
  if (repo !== undefined) out.repo = repo
  if (note !== undefined) out.note = note
  if (built !== undefined) out.built = { ...built }
  if (proven !== undefined) out.proven = { ...proven }
  if (understood !== undefined) out.understood = { ...understood }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Merges every row landing on a live target id (the target's own existing row, if any,
 * plus every vanished row whose idMap chain resolves here) into a single ticket.
 * `vanishedRows` must already be sorted ascending by old id, so ties (proof precedence,
 * sprint tie-break) are resolved deterministically by "smallest old id" regardless of
 * `existing` row order or idMap key iteration order.
 */
function mergeOnto(existingTarget: Ticket | undefined, vanishedRows: Ticket[], c: PlanTicketContent): Ticket {
  const rows = existingTarget ? [existingTarget, ...vanishedRows] : vanishedRows

  const status = rows.reduce<Status>((best, r) => (STATUS_RANK[r.status] > STATUS_RANK[best] ? r.status : best), 'todo')

  const xp = rows.reduce((sum, r) => sum + r.xp, 0)

  let doneAt: number | undefined
  let doneAtApprox: boolean | undefined
  for (const r of rows) {
    if (r.status === 'done' && r.doneAt !== undefined && (doneAt === undefined || r.doneAt < doneAt)) {
      doneAt = r.doneAt
      doneAtApprox = r.doneAtApprox === true
    }
  }

  const slidFrom = [...new Set(rows.flatMap(r => r.slidFrom))].sort((a, b) => a - b)

  const proof = mergeProof(rows)

  // A brand-new target takes its planned sprint from the (possibly restructured) plan,
  // never a vanished row's old sprint — a re-plan must not drag tickets to stale sprints.
  const sprint = existingTarget ? existingTarget.sprint : c.plannedSprint

  const merged: Ticket = { ...(existingTarget ?? newTicket(c)), status, sprint, slidFrom, xp, archived: false }
  delete merged.doneAt
  delete merged.doneAtApprox
  delete merged.proof
  if (doneAt !== undefined) merged.doneAt = doneAt
  if (doneAtApprox === true) merged.doneAtApprox = true
  if (proof) merged.proof = proof

  return withContent(merged, c)
}

export function reconcilePlan(
  existing: Ticket[],
  content: PlanTicketContent[],
  idMap: Record<string, string>,
): ReconcileResult {
  const planById = new Map(content.map(c => [c.id, c]))
  const byId = new Map(existing.map(t => [t.id, t]))
  const next = new Map<string, Ticket>()
  const res: ReconcileResult = { puts: [], deletes: [], renames: [], inserted: [], archived: [] }

  for (const t of existing) {
    const c = planById.get(t.id)
    if (c) next.set(t.id, withContent(t, c))
    // Bank and Mine tickets are not plan content: keep them exactly as they are.
    // An unknown/missing origin is not a bank ticket, so it falls through to the
    // vanished-plan-ticket handling below instead of being kept forever.
    else if (isBankOrigin(t.origin) || t.childOf) next.set(t.id, t)
  }

  const vanished = existing.filter(t => !planById.has(t.id) && !isBankOrigin(t.origin) && !t.childOf).map(t => t.id)
  const vanishedSet = new Set(vanished)
  const mappedFirst = Object.keys(idMap).filter(k => vanishedSet.has(k))
  const mappedSet = new Set(mappedFirst)
  const rest = vanished.filter(id => !mappedSet.has(id)).sort()
  const orderedVanished = [...mappedFirst, ...rest]

  const groups = new Map<string, string[]>()
  for (const id of orderedVanished) {
    const target = resolveId(id, idMap, x => planById.has(x))
    if (target) {
      if (!groups.has(target)) groups.set(target, [])
      groups.get(target)!.push(id)
      res.renames.push({ from: id, to: target })
      res.deletes.push(id)
    } else {
      const old = byId.get(id)!
      if (!old.archived) res.archived.push(id)
      next.set(id, { ...old, archived: true })
    }
  }

  // Sort the aggregate lists so the result never depends on idMap key iteration order
  // or existing-row order.
  res.renames.sort((a, b) => a.from.localeCompare(b.from))
  res.deletes.sort((a, b) => a.localeCompare(b))
  res.archived.sort((a, b) => a.localeCompare(b))

  for (const [target, ids] of groups) {
    const c = planById.get(target)!
    const existingTarget = byId.get(target)
    const vanishedRows = ids
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map(id => byId.get(id)!)
    next.set(target, mergeOnto(existingTarget, vanishedRows, c))
  }

  for (const c of content) {
    if (!next.has(c.id)) {
      next.set(c.id, newTicket(c))
      res.inserted.push(c.id)
    }
  }

  res.puts = [...next.values()]
  return res
}

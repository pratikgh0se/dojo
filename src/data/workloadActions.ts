import type { DojoDB } from './db'
import { getSettings, patchSettings } from './db'
import type { Ticket } from './types'
import { sprintOf } from '../rules/sprint'
import { applyRollover, MAX_CORE_MINUTES, MIN_CORE_MINUTES, rolloverPlan } from '../rules/workload'
import { isContainer } from '../rules/brief'
import { stamp } from './undoSession'

export type Done = { ok: true; count?: number } | { ok: false; message: string }
const fail = (message: string): Done => ({ ok: false, message })

/**
 * Automatic roll-over (spec §3): every unfinished card of an ended sprint moves to the current one.
 * Derived from the database inside the transaction, so running it twice (or from two tabs) is safe.
 * No XP is touched; a `rolled` event is logged per card.
 */
export async function runRollover(d: DojoDB, nowMs: number): Promise<number> {
  return d.transaction('rw', d.tickets, d.events, d.settings, async () => {
    const s = await getSettings(d)
    if (!s.startDate) return 0
    if (s.trackedFrom === undefined) {
      // First look at a plan whose start date was set before tracking was recorded: begin from this sprint.
      await patchSettings(d, { trackedFrom: Math.max(1, sprintOf(nowMs, s.startDate)) })
      return 0
    }
    const plan = rolloverPlan(await d.tickets.toArray(), nowMs, s.startDate, s.trackedFrom)
    const ids: string[] = []
    for (const r of plan) {
      const t = await d.tickets.get(r.id)
      if (!t) continue
      await d.tickets.put(applyRollover(t, r))
      ids.push(r.id)
    }
    // one event per run (like slide_sprint), not one per card: a long absence rolls hundreds of cards
    if (ids.length > 0) await d.events.add({ t: 'rolled', at: nowMs, to: plan[0].to, ids })
    return ids.length
  })
}

/** "Move to sprint…": any unfinished card can go to any sprint. A split card takes its sessions with it. */
export async function moveToSprint(d: DojoDB, id: string, to: number, nowMs: number, why: 'manual' | 'rebalance' = 'manual'): Promise<Done> {
  if (!Number.isInteger(to) || to < 1) return fail('Pick a sprint number from 1 up')
  return d.transaction('rw', d.tickets, d.events, async (): Promise<Done> => {
    const t = await d.tickets.get(id)
    if (!t || t.archived) return fail('Ticket not found')
    if (t.status === 'done') return fail('A finished card stays in the sprint where it was done')
    if (t.sprint === to) return fail(`Already in Sprint ${to}`)
    const group: Ticket[] = [t]
    if (isContainer(t)) group.push(...(await d.tickets.bulkGet(t.children ?? [])).filter((c): c is Ticket => c !== undefined && !c.archived && c.status !== 'done'))
    for (const g of group) {
      const { carry: _c, ...rest } = g
      await d.tickets.put({ ...rest, sprint: to })
      await d.events.add(stamp({ t: 'moved', id: g.id, at: nowMs, from: g.sprint, to, why }))
    }
    return { ok: true, count: group.length }
  })
}

/** Accepting a rebalance: exactly the checked cards go to the target sprint. Cards that changed since are skipped. */
export async function applyRebalance(d: DojoDB, ids: readonly string[], from: number, to: number, nowMs: number): Promise<Done> {
  return d.transaction('rw', d.tickets, d.events, async (): Promise<Done> => {
    let count = 0
    for (const id of ids) {
      const t = await d.tickets.get(id)
      if (!t || t.archived || t.sprint !== from || t.status === 'done' || t.pinned) continue
      const { carry: _c, ...rest } = t
      await d.tickets.put({ ...rest, sprint: to })
      await d.events.add(stamp({ t: 'moved', id, at: nowMs, from, to, why: 'rebalance' }))
      count++
    }
    return count === 0 ? fail('Nothing to move') : { ok: true, count }
  })
}

export async function setPinned(d: DojoDB, id: string, pinned: boolean): Promise<Done> {
  return d.transaction('rw', d.tickets, async (): Promise<Done> => {
    const t = await d.tickets.get(id)
    if (!t || t.archived) return fail('Ticket not found')
    if (!!t.pinned === pinned) return { ok: true }
    const { pinned: _p, ...rest } = t
    await d.tickets.put(pinned ? { ...rest, pinned: true } : rest)
    return { ok: true }
  })
}

export const CORE_MINUTES_ERROR = `Core minutes must be a whole number from ${MIN_CORE_MINUTES} to ${MAX_CORE_MINUTES}`

export async function saveCoreMinutes(d: DojoDB, minutes: number): Promise<Done> {
  if (!Number.isInteger(minutes) || minutes < MIN_CORE_MINUTES || minutes > MAX_CORE_MINUTES) return fail(CORE_MINUTES_ERROR)
  await patchSettings(d, { coreMinutes: minutes })
  return { ok: true }
}

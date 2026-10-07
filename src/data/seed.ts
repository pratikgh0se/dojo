import { getSettings, type DojoDB } from './db'
import type { PlanJson, StoredEvent } from './types'
import { idMapOf, isPlanJson, planToTickets, planVersionOf } from '../rules/planTickets'
import { resolveLearnerLinks } from '../rules/learnerLinks'
import { reconcilePlan, type ReconcileResult } from '../rules/reconcile'
import { possibleXp } from '../rules/xp'

export type PlanLoad = { ok: true; plan: PlanJson } | { ok: false; error: string }

export async function loadPlan(fetcher: typeof fetch = fetch, url = '/data/plan.json'): Promise<PlanLoad> {
  let res: Response
  try {
    res = await fetcher(url)
  } catch (e) {
    return { ok: false, error: `Could not fetch ${url}: ${String(e)}` }
  }
  if (!res.ok) return { ok: false, error: `${url} returned HTTP ${res.status}` }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, error: `${url} is not valid JSON` }
  }
  if (!isPlanJson(json)) return { ok: false, error: `${url} is missing sprints/rotation/dsa_bank/design_bank` }
  // G6: `{{learner.*}}` links resolve from the plan's learner block (DOJO_HOME/profile.json), or drop out
  return { ok: true, plan: resolveLearnerLinks(json) }
}

export async function runReconcile(d: DojoDB, plan: PlanJson): Promise<ReconcileResult> {
  const content = planToTickets(plan)
  const idMap = idMapOf(plan)
  return d.transaction('rw', [d.tickets, d.sessions, d.events, d.settings], async () => {
    const existing = await d.tickets.toArray()
    const res = reconcilePlan(existing, content, idMap)
    if (res.deletes.length) await d.tickets.bulkDelete(res.deletes)
    await d.tickets.bulkPut(res.puts)
    for (const { from, to } of res.renames) {
      await d.sessions.where('ticketId').equals(from).modify(s => { s.ticketId = to })
      await d.events.where('id').equals(from).modify(e => { (e as { id?: string }).id = to })
      const toMapOf = (e: StoredEvent): Record<string, number> | null => {
        const map = (e as unknown as { to?: unknown }).to
        return map && typeof map === 'object' && !Array.isArray(map) ? (map as Record<string, number>) : null
      }
      await d.events
        .filter(e => ('ids' in e && Array.isArray(e.ids) && e.ids.includes(from)) || Boolean(toMapOf(e)?.[from] !== undefined))
        .modify(e => {
          if ('ids' in e && Array.isArray(e.ids)) e.ids = e.ids.map(x => (x === from ? to : x))
          // shift_plan events carry a `to` map keyed by ticket id (id -> resulting sprint);
          // a rename must remap that map's KEY too, not just the `ids` array.
          const map = toMapOf(e)
          if (map && from in map) {
            map[to] = map[from]
            delete map[from]
          }
        })
    }
    const settings = await getSettings(d)
    await d.settings.put({ ...settings, planVersion: planVersionOf(plan), possibleXp: possibleXp(res.puts) })
    return res
  })
}

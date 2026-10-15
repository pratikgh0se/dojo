import { getSettings, type DojoDB } from './db'
import type { PlanJson } from './types'
import { remapTables, remapTicketIds } from './remapActions'
import { isPlanV2, type PlanV2 } from './planV2'
import { PlanDataError, assertPlanV2Shape, idMapOf, planToTickets, planVersionOf } from '../rules/planTickets'
import { resolveLearnerLinks } from '../rules/learnerLinks'
import { reconcilePlan, type ReconcileResult } from '../rules/reconcile'
import { possibleXp } from '../rules/xp'

/** `v2` is the plan; `plan` is the slim view of it that the bank screens read (banks, id map, version, learner links). */
export type PlanLoad = { ok: true; plan: PlanJson; v2: PlanV2 } | { ok: false; error: string }

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
  if (!isPlanV2(json)) return { ok: false, error: `${url} is not a plan v2 (planFormat 2)` }
  // isPlanV2 is shallow by contract; a v2 plan missing a deeper part is a plan error card, not a TypeError out of boot
  try {
    assertPlanV2Shape(json)
  } catch (e) {
    if (e instanceof PlanDataError) return { ok: false, error: `${url} is not a valid plan v2: ${e.message}` }
    throw e
  }
  // G6: `{{learner.*}}` links resolve from the plan's learner block (DOJO_HOME/profile.json), or drop out
  const v2 = resolveLearnerLinks(json)
  const plan: PlanJson = {
    planVersion: v2.planVersion, idMap: v2.idMap, dsa_bank: v2.dsa_bank, design_bank: v2.design_bank,
    ...(v2.learner ? { learner: v2.learner } : {}),
  }
  return { ok: true, plan, v2 }
}

export async function runReconcile(d: DojoDB, plan: PlanV2): Promise<ReconcileResult> {
  const content = planToTickets(plan)
  const idMap = idMapOf(plan)
  return d.transaction('rw', [...remapTables(d), d.settings], async () => {
    const existing = await d.tickets.toArray()
    const res = reconcilePlan(existing, content, idMap)
    if (res.deletes.length) await d.tickets.bulkDelete(res.deletes)
    await d.tickets.bulkPut(res.puts)
    await remapTicketIds(d, res.renames)
    const settings = await getSettings(d)
    await d.settings.put({ ...settings, planVersion: planVersionOf(plan), possibleXp: possibleXp(res.puts) })
    return res
  })
}

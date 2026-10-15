import type { Kind, Link, PlanDesignTier, PlanDsaSprint, Ticket } from '../data/types'
import type { PlanTicketV2, PlanV2 } from '../data/planV2'

export type PlanTicketContent =
  Pick<Ticket, 'id' | 'origin' | 'track' | 'kind' | 'title' | 'links' | 'estMin' | 'plannedSprint' | 'order'> &
  Partial<Pick<Ticket, 'text' | 'skill' | 'pattern' | 'difficulty' | 'stage' | 'session' | 'lane' | 'node' | 'area' | 'phase' | 'explain' | 'explainAnswers' | 'lab' | 'asOf'>>

export const EST_MIN: Record<Kind, number> = {
  task: 50, problem: 30, design: 45, stage: 50, watch: 45, read: 40, build: 75, writeup: 60, ritual: 60,
}

export const CONTENT_KEYS = [
  'origin', 'track', 'kind', 'title', 'text', 'links', 'skill', 'pattern', 'difficulty', 'estMin', 'plannedSprint', 'order',
  'stage', 'session', 'lane', 'node', 'area', 'phase', 'explain', 'explainAnswers', 'lab', 'asOf',
] as const

/** Learner-owned ticket fields (master D11): not plan content, so a refresh and a reconcile never touch them. */
export const LEARNER_KEYS = ['learnerNotes', 'explainResponses', 'selfMark', 'learnerUpdatedAt'] as const

export function tierRange(tier: string): [number, number] {
  const m = /sprints (\d+) to (\d+)/.exec(tier)
  return m ? [Number(m[1]), Number(m[2])] : [1, 72]
}

export function planVersionOf(plan: { planVersion?: string }): string {
  return plan.planVersion ?? 'unversioned'
}

export function idMapOf(plan: { idMap?: Record<string, string> }): Record<string, string> {
  return plan.idMap && typeof plan.idMap === 'object' ? { ...plan.idMap } : {}
}

export class PlanDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanDataError'
  }
}

function check(cond: unknown, message: string): asserts cond {
  if (!cond) throw new PlanDataError(message)
}

const copyLinks = (ls: Link[]): Link[] => ls.map(l => ({ label: l.label, url: l.url }))

/**
 * The deeper shape of a plan v2 that `isPlanV2` (shallow by contract) does not check: the arrays and the weekly budgets that
 * the learner-link resolver and the ticket converter read. Throws a PlanDataError, so a hand-edited plan.json is an error card
 * and not a TypeError out of boot.
 */
export function assertPlanV2Shape(plan: PlanV2): void {
  for (const k of ['tasks', 'dsa_bank', 'design_bank'] as const) check(Array.isArray(plan[k]), `${k} must be an array`)
  const b = (plan.mix as { budgets?: unknown }).budgets
  check(Array.isArray(b) && b.length === 7 && b.every(x => typeof x === 'number' && Number.isFinite(x)), 'mix.budgets must be 7 numbers (Sunday first)')
  for (const t of [...plan.tickets, ...plan.tasks]) {
    check(typeof t === 'object' && t !== null, 'a plan ticket is not an object')
    check(t.links === undefined || Array.isArray(t.links), `${t.id}: links must be an array`)
  }
  for (const w of plan.dsa_bank) check(typeof w === 'object' && w !== null && Array.isArray(w.problems), `dsa sprint ${(w as { sprint?: unknown } | null)?.sprint}: problems must be an array`)
  for (const tier of plan.design_bank) {
    check(typeof tier === 'object' && tier !== null && Array.isArray(tier.items), `${(tier as { tier?: unknown } | null)?.tier}: items must be an array`)
    for (const it of tier.items) check(typeof it === 'object' && it !== null && Array.isArray(it.refs), `${(it as { id?: unknown } | null)?.id}: refs must be an array`)
  }
}

/** Ideal-pace position: minutes before this ticket in its lane over the lane's share (spec 3.1, "Order"). */
export function paceOrder(cumMinutesBefore: number, share: number, index: number): number {
  return cumMinutesBefore / Math.max(1, share) + index * 1e-6
}

type Stamped = { order?: number; estMin?: number }

const EST_MIN_LO = 15
const EST_MIN_HI = 120
/** Half an index step: design fallbacks sit between the dsa ones so equal ideal-pace positions never tie across lanes. */
const DESIGN_LANE_SALT = 0.5

const checkEst = (id: string, v: unknown): number => {
  check(typeof v === 'number' && Number.isFinite(v) && v >= EST_MIN_LO && v <= EST_MIN_HI, `${id}: estMin must be a number from ${EST_MIN_LO} to ${EST_MIN_HI}`)
  return v
}
const checkOrder = (id: string, v: unknown): number => {
  check(typeof v === 'number' && Number.isFinite(v), `${id}: order must be a number, and a finite one`)
  return v
}
const shareOf = (plan: PlanV2, lane: 'dsa' | 'design'): number => {
  const v = (plan.mix.shares as Record<string, unknown>)[lane]
  check(typeof v === 'number' && Number.isFinite(v) && v > 0, `plan v2: mix.shares.${lane} must be a positive number to place unstamped ${lane} items`)
  return v
}

/**
 * Plan v2 -> ticket content, sorted by `order`. `plannedSprint` is not a v2 concept; legacy readers still need one, so it is the
 * 14-day window (twice the weekly budget total) the ticket starts in when the plan is worked in order, capped at 72.
 *
 * A bank (dsa or design) is either fully stamped with `order` by the generator or not stamped at all. A wholly unstamped bank
 * is placed at its ideal-pace position (`paceOrder`); a bank with only some items stamped is malformed and refused.
 */
export function planToTickets(plan: PlanV2): PlanTicketContent[] {
  check(Array.isArray(plan.tickets) && Array.isArray(plan.tasks), 'plan v2: tickets and tasks must be arrays')
  check(plan.mix && plan.mix.shares, 'plan v2: mix.shares is required')
  assertPlanV2Shape(plan)
  const out: Omit<PlanTicketContent, 'plannedSprint'>[] = []
  const fromTicket = (t: PlanTicketV2): Omit<PlanTicketContent, 'plannedSprint'> => {
    check(typeof t.id === 'string' && t.id.length > 0, 'plan v2: ticket without an id')
    check(Array.isArray(t.links), `${t.id}: links must be an array`)
    check(typeof t.text === 'string' && typeof t.title === 'string', `${t.id}: title and text must be strings`)
    checkEst(t.id, t.estMin)
    check(Number.isInteger(t.estMin), `${t.id}: estMin must be a whole number`)
    checkOrder(t.id, t.order)
    return {
      id: t.id, origin: 'plan', track: t.track, kind: t.kind, title: t.title, text: t.text, links: copyLinks(t.links),
      estMin: t.estMin, order: t.order, lane: t.lane,
      ...(t.skill !== undefined ? { skill: t.skill } : {}),
      ...(t.node !== undefined ? { node: t.node } : {}),
      ...(t.area !== undefined ? { area: t.area } : {}),
      ...(t.phase !== undefined ? { phase: t.phase } : {}),
      ...(t.explain ? { explain: [...t.explain] } : {}),
      ...(t.explainAnswers ? { explainAnswers: [...t.explainAnswers] } : {}),
      ...(t.lab ? { lab: { ...t.lab } } : {}),
      ...(t.asOf !== undefined ? { asOf: t.asOf } : {}),
    }
  }
  for (const t of plan.tickets) out.push(fromTicket(t))
  for (const t of plan.tasks) out.push(fromTicket(t))

  // TREE-03: a bank problem or design item with a skill-tree node stamps `node` and the node's `area` on its ticket; without one, neither.
  const nodeArea = new Map(plan.nodes.map(n => [n.id, n.area]))
  const treeStamp = (node: string | undefined, fallbackArea: string): { node?: string; area?: string } =>
    typeof node === 'string' && node ? { node, area: nodeArea.get(node) ?? fallbackArea } : {}
  let dsaMin = 0
  let dsaIdx = 0
  for (const w of plan.dsa_bank) {
    check(Array.isArray(w.problems), `dsa sprint ${w.sprint}: problems must be an array`)
  }
  const dsaProblems = plan.dsa_bank.flatMap(w => w.problems.map(p => ({ w, p: p as PlanDsaSprint['problems'][number] & Stamped })))
  const dsaStamped = dsaProblems.filter(x => x.p.order !== undefined).length
  for (const { w, p } of dsaProblems) {
    check(typeof p.num === 'number', `dsa sprint ${w.sprint}: problem without a numeric num`)
    const estMin = p.estMin === undefined ? EST_MIN.problem : checkEst(`p${p.num}`, p.estMin)
    if (dsaStamped > 0) checkOrder(`p${p.num}`, p.order)
    out.push({
      id: `p${p.num}`, origin: 'plan', track: 'interview', kind: 'problem', title: `${p.num} · ${p.name}`, text: w.topic,
      links: [{ label: `LeetCode ${p.num}`, url: p.url }], skill: 'dsa', pattern: w.pattern, difficulty: p.difficulty, estMin,
      lane: 'dsa', order: dsaStamped > 0 ? (p.order as number) : paceOrder(dsaMin, shareOf(plan, 'dsa'), dsaIdx),
      ...treeStamp(p.node, 'dsa'),
    })
    dsaMin += estMin
    dsaIdx++
  }
  let designMin = 0
  let designIdx = 0
  for (const tier of plan.design_bank) {
    check(Array.isArray(tier.items), `${tier.tier}: items must be an array`)
  }
  const designItems = plan.design_bank.flatMap(tier => tier.items.map(it => ({ tier, it: it as PlanDesignTier['items'][number] & Stamped })))
  const designStamped = designItems.filter(x => x.it.order !== undefined).length
  for (const { tier, it } of designItems) {
    check(typeof it.id === 'string' && it.id.length > 0, `${tier.tier}: design without an id`)
    check(Array.isArray(it.refs), `${it.id}: refs must be an array`)
    const estMin = it.estMin === undefined ? EST_MIN.design : checkEst(it.id, it.estMin)
    if (designStamped > 0) checkOrder(it.id, it.order)
    out.push({
      id: it.id, origin: 'plan', track: 'interview', kind: 'design', title: it.title, text: it.deep_dives.map(x => `• ${x}`).join('\n'),
      links: copyLinks(it.refs), skill: tier.skill, difficulty: it.difficulty, estMin, lane: 'design',
      order: designStamped > 0 ? (it.order as number) : paceOrder(designMin, shareOf(plan, 'design'), designIdx + DESIGN_LANE_SALT),
      ...treeStamp(it.node, 'design'),
    })
    designMin += estMin
    designIdx++
  }
  const ids = new Set<string>()
  const orders = new Set<number>()
  for (const c of out) {
    check(!ids.has(c.id), `duplicate id ${c.id}`)
    check(!orders.has(c.order), `duplicate order ${c.order} (${c.id})`)
    ids.add(c.id)
    orders.add(c.order)
  }
  out.sort((a, b) => a.order - b.order)
  const windowMin = Math.max(1, 2 * plan.mix.budgets.reduce((a, b) => a + b, 0))
  let done = 0
  return out.map(r => {
    const plannedSprint = Math.min(72, 1 + Math.floor(done / windowMin))
    done += r.estMin
    return { ...r, plannedSprint }
  })
}

export function newTicket(c: PlanTicketContent): Ticket {
  return { ...c, sprint: c.plannedSprint, status: 'todo', slidFrom: [], xp: 0, archived: false }
}

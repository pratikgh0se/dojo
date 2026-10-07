import type { Kind, Link, PlanJson, PlanTask, Ticket, Track } from '../data/types'

export type PlanTicketContent =
  Pick<Ticket, 'id' | 'origin' | 'track' | 'kind' | 'title' | 'links' | 'estMin' | 'plannedSprint' | 'order'> &
  Partial<Pick<Ticket, 'text' | 'skill' | 'pattern' | 'difficulty' | 'stage' | 'session'>>

export const EST_MIN: Record<Kind, number> = { task: 50, problem: 30, design: 45, stage: 50, watch: 50, read: 50 }

export const CONTENT_KEYS = [
  'origin', 'track', 'kind', 'title', 'text', 'links', 'skill', 'pattern', 'difficulty', 'estMin', 'plannedSprint', 'order',
  'stage', 'session',
] as const

/**
 * A card's title is the first sentence of its task text, whole. It was once cut at 72 characters with a "…" in the data
 * ("Set the routine: …; the…"), which no screen could undo (UAT cu-3 P3-8): a long title is clamped where it is shown, by
 * CSS (the Board card's three lines, a row's ellipsis), and the full text is its `title` attribute.
 */
export function titleFromText(text: string): string {
  return text.split(/\.\s/)[0].trim()
}

export function tierRange(tier: string): [number, number] {
  const m = /sprints (\d+) to (\d+)/.exec(tier)
  return m ? [Number(m[1]), Number(m[2])] : [1, 72]
}

export function planVersionOf(plan: PlanJson): string {
  return plan.planVersion ?? plan.generated ?? 'unversioned'
}

export function idMapOf(plan: PlanJson): Record<string, string> {
  return plan.idMap && typeof plan.idMap === 'object' ? { ...plan.idMap } : {}
}

export function isPlanJson(v: unknown): v is PlanJson {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return (
    Array.isArray(p.sprints) && p.sprints.length > 0 &&
    typeof p.rotation === 'object' && p.rotation !== null &&
    Array.isArray(p.dsa_bank) && Array.isArray(p.design_bank)
  )
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

export function planToTickets(plan: PlanJson): PlanTicketContent[] {
  const out: PlanTicketContent[] = []
  let order = 0
  for (const s of plan.sprints) {
    check(Array.isArray(s.ai) && Array.isArray(s.interview), `sprint ${s.sprint}: ai/interview must be arrays`)
    const add = (track: Track) => (t: PlanTask) => {
      check(typeof t.id === 'string' && t.id.length > 0, `sprint ${s.sprint}: task without an id`)
      check(Array.isArray(t.links), `${t.id}: links must be an array`)
      check(typeof t.text === 'string', `${t.id}: text must be a string`)
      // 'watch' and 'read' are learning cards (briefs Addendum 1 Q1); a plan may tag its tasks with them
      const kind: Kind = t.kind === 'stage' || t.kind === 'watch' || t.kind === 'read' ? t.kind : 'task'
      out.push({
        id: t.id, origin: 'plan', track, kind, title: titleFromText(t.text), text: t.text,
        links: copyLinks(t.links), skill: t.skill, estMin: EST_MIN[kind], plannedSprint: s.sprint, order: order++,
        ...(t.stage !== undefined ? { stage: t.stage } : {}),
        ...(t.session !== undefined ? { session: t.session } : {}),
      })
    }
    s.ai.forEach(add('ai'))
    s.interview.forEach(add('interview'))
  }
  for (const w of plan.dsa_bank) {
    check(Array.isArray(w.problems), `dsa sprint ${w.sprint}: problems must be an array`)
    for (const p of w.problems) {
      check(typeof p.num === 'number', `dsa sprint ${w.sprint}: problem without a numeric num`)
      out.push({
        id: `p${p.num}`, origin: 'plan', track: 'interview', kind: 'problem', title: `${p.num} · ${p.name}`,
        text: w.topic, links: [{ label: `LeetCode ${p.num}`, url: p.url }], skill: 'dsa', pattern: w.pattern,
        difficulty: p.difficulty, estMin: EST_MIN.problem, plannedSprint: w.sprint, order: order++,
      })
    }
  }
  for (const tier of plan.design_bank) {
    check(Array.isArray(tier.items), `${tier.tier}: items must be an array`)
    const [a, b] = tierRange(tier.tier)
    tier.items.forEach((it, k) => {
      check(typeof it.id === 'string' && it.id.length > 0, `${tier.tier}: design without an id`)
      check(Array.isArray(it.refs), `${it.id}: refs must be an array`)
      out.push({
        id: it.id, origin: 'plan', track: 'interview', kind: 'design', title: it.title,
        text: it.deep_dives.map(x => `• ${x}`).join('\n'), links: copyLinks(it.refs), skill: tier.skill,
        difficulty: it.difficulty, estMin: EST_MIN.design,
        plannedSprint: a + Math.floor((k * (b - a + 1)) / tier.items.length), order: order++,
      })
    })
  }
  const seen = new Set<string>()
  for (const c of out) {
    check(!seen.has(c.id), `duplicate id ${c.id}`)
    seen.add(c.id)
  }
  return out
}

export function newTicket(c: PlanTicketContent): Ticket {
  return { ...c, sprint: c.plannedSprint, status: 'todo', slidFrom: [], xp: 0, archived: false }
}

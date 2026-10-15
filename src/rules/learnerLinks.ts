import type { PlanV2 } from '../data/planV2'
import type { PlanLearner, PlanLink } from '../data/types'

/** G6: a plan link whose url is `{{learner.<key>}}` points at the learner's own page (a setting, not shipped data). */
const PLACEHOLDER = /^\{\{learner\.(\w+)\}\}$/

/** The link with its placeholder resolved from `learner`, or null when the learner has not set that link. */
export function resolveLearnerLink(link: PlanLink, learner: PlanLearner | undefined): PlanLink | null {
  const m = PLACEHOLDER.exec(link.url)
  if (!m) return link
  const url = (learner as Record<string, unknown> | undefined)?.[m[1]]
  return typeof url === 'string' && url.trim() !== '' ? { ...link, url: url.trim() } : null
}

/**
 * The plan with every `{{learner.*}}` link in the path tickets, the kept tasks and the design bank resolved from `plan.learner`;
 * unset ones are dropped. Always returns a new object, placeholder or not (the DSA bank has no learner links).
 * Tolerant of absent or mistyped parts, which pass through untouched (the loader's shape check reports them; this must never throw).
 */
export function resolveLearnerLinks(plan: PlanV2): PlanV2 {
  const fix = (links: PlanLink[] | undefined): PlanLink[] | undefined =>
    Array.isArray(links) ? links.map(l => resolveLearnerLink(l, plan.learner)).filter((l): l is PlanLink => l !== null) : links
  const rows = <T extends { links: PlanLink[] }>(ts: T[]): T[] =>
    Array.isArray(ts) ? ts.map(t => (t && typeof t === 'object' ? { ...t, links: fix(t.links) ?? t.links } : t)) : ts
  const bank = plan.design_bank as { items?: { refs: PlanLink[] }[] }[]
  return {
    ...plan,
    tickets: rows(plan.tickets),
    tasks: rows(plan.tasks),
    design_bank: (Array.isArray(bank)
      ? bank.map(tier => (tier && Array.isArray(tier.items) ? { ...tier, items: tier.items.map(i => (i && typeof i === 'object' ? { ...i, refs: fix(i.refs) ?? i.refs } : i)) } : tier))
      : bank) as PlanV2['design_bank'],
  }
}

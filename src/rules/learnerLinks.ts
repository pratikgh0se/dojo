import type { PlanJson, PlanLearner, PlanLink } from '../data/types'

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
 * The plan with every `{{learner.*}}` link in sprints, the AI shelf and the design bank resolved from `plan.learner`;
 * unset ones are dropped. A plan with no placeholder comes back as is.
 */
export function resolveLearnerLinks(plan: PlanJson): PlanJson {
  const fix = (links: PlanLink[] | undefined): PlanLink[] | undefined =>
    Array.isArray(links) ? links.map(l => resolveLearnerLink(l, plan.learner)).filter((l): l is PlanLink => l !== null) : links
  const fixTasks = <T extends { links: PlanLink[] }>(ts: T[]): T[] =>
    Array.isArray(ts) ? ts.map(t => (t && typeof t === 'object' ? { ...t, links: fix(t.links) ?? t.links } : t)) : ts
  return {
    ...plan,
    sprints: plan.sprints.map(s => (s && typeof s === 'object' ? { ...s, ai: fixTasks(s.ai), interview: fixTasks(s.interview) } : s)),
    ai_shelf: plan.ai_shelf ? fixTasks(plan.ai_shelf) : plan.ai_shelf,
    design_bank: plan.design_bank.map(t => (t && Array.isArray(t.items) ? { ...t, items: t.items.map(d => (d && typeof d === 'object' ? { ...d, refs: fix(d.refs) ?? d.refs } : d)) } : t)),
  }
}

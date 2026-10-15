// Card briefs (v2 part 3, spec §1): pure rules. No React, no Dexie.
import type { BriefContext, BriefDeliverable, BriefOutput, BriefQuestion } from '../ai/types'
import type { Brief, Ticket } from '../data/types'

/** A learning card: a video or a reading. It gets an answers deliverable and the check. */
export const isLearning = (t: Pick<Ticket, 'kind'>): boolean => t.kind === 'watch' || t.kind === 'read'

/** The minutes of a card: the brief's estimate, else the per-kind default (`estMin`). */
export function minutesOf(t: Pick<Ticket, 'brief' | 'estMin'>): number {
  return t.brief?.minutes ?? t.estMin
}

export function briefContext(t: Ticket): BriefContext {
  return { kind: t.kind, learning: isLearning(t), estMin: minutesOf(t) }
}

/** What a card asks to be handed in (the call signature `deliverableOf(ticket, brief?)` is unchanged). */
export function deliverableOf(t: Pick<Ticket, 'brief'>, brief: Pick<Brief, 'deliverable'> | undefined = t.brief): BriefDeliverable | null {
  return brief?.deliverable ?? null
}

/** A fresh draft from a job's output. A `split` key (the retired split suggestion a model may still emit) is never stored. */
export function toBrief(out: BriefOutput): Brief {
  const { split: _split, ...rest } = out as BriefOutput & { split?: unknown }
  return { ...rest, status: 'draft', source: 'ai' }
}

const DRAFTABLE = new Set<Ticket['kind']>(['problem', 'design', 'task'])
/** Briefs are drafted for problem, design and task tickets only (spec 3.2). */
export const isDraftable = (t: Pick<Ticket, 'kind'>): boolean => DRAFTABLE.has(t.kind)

/** Sprint N's cards that still need a draft, in plan order (unfinished, live, draftable). */
export function sprintDraftQueue(tickets: Ticket[], sprint: number): Ticket[] {
  return tickets
    .filter(t => !t.archived && t.sprint === sprint && t.status !== 'done' && !t.brief && isDraftable(t))
    .sort((a, b) => a.order - b.order)
}

/** A learning card with a brief and questions is finished through its check, never by a tick (briefs Addendum 3). */
export function needsCheck(t: Pick<Ticket, 'brief' | 'status' | 'kind'>): boolean {
  if (t.status === 'done' || !t.brief) return false
  // a watch or read card always needs it: taking the questions out of its brief must not switch the check off
  return isLearning(t) || (t.brief.deliverable.kind === 'answers' && t.brief.questions.length > 0)
}

export const BRIEF_STATUS_LABEL: Record<Brief['status'], string> = { draft: 'Draft', approved: 'Approved' }

export function stepUrls(b: Pick<Brief, 'steps'>): string[] {
  return [...new Set(b.steps.flatMap(s => (s.url ? [s.url] : [])))]
}

/**
 * UAT cu-4 P3-4: what a link check result means. 2xx and 3xx are ok. A host that answers 401, 403 or 429 (or LinkedIn's 999)
 * is alive and turning the automatic check away (a bot wall: leetcode.com answers every non-browser request 403), so the link
 * is "can't verify", never "broken". Anything else that is not ok (404, 410, 5xx, no answer at all) is broken.
 */
export type LinkVerdict = 'ok' | 'unverified' | 'broken'
const REFUSES_THE_CHECK = new Set([401, 403, 429, 999])
export function linkVerdict(r: { ok: boolean; status: number }): LinkVerdict {
  if (r.ok) return 'ok'
  return REFUSES_THE_CHECK.has(r.status) ? 'unverified' : 'broken'
}
export const LINK_UNVERIFIED_HINT = 'The site refused the automatic check, so the link is not confirmed broken. Open it to see.'

export const minutesLabel = (m: number): string => `${m} min`

export function newQuestionId(qs: readonly BriefQuestion[]): string {
  let n = qs.length + 1
  while (qs.some(q => q.id === `q${n}`)) n++
  return `q${n}`
}

/** A learning card (a video or reading) hands in answers; a build card hands in the deliverable. */
export function isLearningCard(t: Pick<Ticket, 'brief'>): boolean {
  return t.brief?.deliverable.kind === 'answers'
}

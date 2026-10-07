// Card briefs (v2 part 3, spec §1): pure rules. No React, no Dexie.
import { FORGE_DELIVERABLE_PROMPT, TEACHBACK_DELIVERABLE_PROMPT } from '../ai/forgeConst'
import type { BriefContext, BriefDeliverable, BriefOutput, BriefQuestion } from '../ai/types'
import type { Brief, Ticket } from '../data/types'
import { isPart } from './units'

/** A learning card: a video or a reading (Addendum 1 Q1). */
/**
 * A learning card (briefs Addendum 1 Q1, Addendum 4): a watch or read card, or a stage ticket whose plan session is
 * watch ("watch and type along"). It gets the answers deliverable and the check. Forge build and rebuild stages don't.
 */
export const isLearning = (t: Pick<Ticket, 'kind' | 'session'>): boolean =>
  t.kind === 'watch' || t.kind === 'read' || (t.kind === 'stage' && t.session === 'watch')

/**
 * A teach-back card (UAT cu-5 P2-2): a stage ticket whose plan session is teachback ("sketch the mechanism on paper or
 * explain it in writing, then grade it against the rubric"). It hands in an explanation, not code.
 */
export const isTeachback = (t: Pick<Ticket, 'kind' | 'session'>): boolean => t.kind === 'stage' && t.session === 'teachback'

/** Forge cards are AI-track work that is not a watch or read card (Addendum 1 Q10): the AI never writes their code. */
export function isForge(t: Pick<Ticket, 'track' | 'kind' | 'session'>): boolean {
  return t.track === 'ai' && !isLearning(t)
}

/** A container was split into sessions; it is done when its children are (BR-08). */
export function isContainer(t: Pick<Ticket, 'children'>): boolean {
  return (t.children?.length ?? 0) > 0
}

/** The minutes of a card: the brief's estimate, else the per-kind default (`estMin`). */
export function minutesOf(t: Pick<Ticket, 'brief' | 'estMin'>): number {
  return t.brief?.minutes ?? t.estMin
}

export function briefContext(t: Ticket): BriefContext {
  return {
    kind: t.kind, forge: isForge(t), learning: isLearning(t), ...(isTeachback(t) ? { teachback: true } : {}), estMin: minutesOf(t), sprint: t.sprint,
    ...(t.session ? { session: t.session } : {}),
    ...(t.stage !== undefined ? { stage: t.stage } : {}),
  }
}

/**
 * Removes code from prose: fenced blocks in ``` or ~~~ (an unmatched opening fence runs to the end of the
 * string) and inline `code` spans, including an unmatched backtick to the end.
 */
export function stripCode(s: string): string {
  const out: string[] = []
  let fence: string | null = null
  for (const line of s.split('\n')) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && line.trim() === m[1]) fence = null
      continue
    }
    if (m) { fence = m[1]; continue }
    out.push(line)
  }
  return out.join('\n').replace(/`+[^`]*`+/g, '').replace(/`+[^`]*$/, '').replace(/[ \t]+\n/g, '\n').trim()
}

const LIST_MARKER = /^\s*([-*+]|\d+[.)])\s/
/**
 * A line that reads as code rather than prose (conservative). Never a list item. Otherwise only: a lower-case code
 * start followed by code syntax (`def name(`, `class Name:`, `func name(`, `import x` alone or `as y`, `for (… = … ;`,
 * `return f(x)` / `return x;` / `return a + b`), or a line ending in "{". Indentation and a trailing ";" are not
 * signs of code: prose has both (indented paragraphs, formulas, lists).
 */
export function looksLikeCodeLine(line: string): boolean {
  if (LIST_MARKER.test(line)) return false
  return (
    /^\s*def \w+\(/.test(line) ||
    /^\s*class \w+(\(.*\))?\s*[:{]\s*$/.test(line) ||
    /^\s*func \w+\(/.test(line) ||
    /^\s*import [\w.]+(\s+as \w+)?\s*$/.test(line) ||
    /^\s*for \(.*[=;<]/.test(line) ||
    /^\s*return\s+[\w.]+\s*(\(.*\)|;|\[.*\]|[-+*/%<>=]+\s*\S.*)\s*$/.test(line) ||
    /\{\s*$/.test(line)
  )
}

/** True when a string carries a code fence, backtick code or lines that look like code (a forge brief must not). */
export const hasCode = (s: string): boolean =>
  /(^|\n)\s*(`{3,}|~{3,})/.test(s) || s.includes('`') || s.split('\n').some(looksLikeCodeLine)

/** Every text field of a brief output (what could smuggle code in). */
export function briefStrings(o: BriefOutput): string[] {
  return [
    o.goal, o.outcome, o.deliverable.prompt, ...o.learn, ...o.steps.flatMap(s => [s.text, s.url ?? '']),
    ...o.questions.flatMap(q => [q.q, ...(q.choices ?? []), ...(q.keyIdeas ?? [])]), ...(o.split ?? []).map(p => p.title),
  ]
}

/** A forge brief with code in it is rejected by the drafting action as invalid_output, never silently edited. */
export const forgeCodeProblem = (o: BriefOutput): string | null =>
  briefStrings(o).some(hasCode) ? 'a forge brief must not contain code (a fence, backticks or code-looking lines)' : null

/**
 * Belt and braces behind forgeCodeProblem: whatever came back, a forge card's deliverable is the one canonical
 * "typed by hand" prompt, it has no questions, and every text field is scrubbed of code. A teach-back card's is the
 * explanation prompt instead (UAT cu-5 P2-2): there is no code to type, so asking for it made "Get feedback" grade prose as code.
 */
export function enforceForge(out: BriefOutput, forge: boolean, teachback = false): BriefOutput {
  if (!forge) return out
  const clean = (s: string, fallback: string) => stripCode(s) || fallback
  return {
    ...out,
    goal: clean(out.goal, 'Work through the reference by hand'),
    outcome: clean(out.outcome, 'You have typed it out yourself'),
    learn: out.learn.map(l => stripCode(l)).filter(Boolean),
    steps: out.steps.map(s => ({ ...s, text: clean(s.text, 'Work through the reference by hand') })),
    deliverable: teachback ? { kind: 'explanation', prompt: TEACHBACK_DELIVERABLE_PROMPT } : { kind: 'code', prompt: FORGE_DELIVERABLE_PROMPT },
    questions: [],
    ...(out.split ? { split: out.split.map(p => ({ ...p, title: clean(p.title, 'Session') })) } : {}),
  }
}

/**
 * What a card asks to be handed in. A teach-back card drafted before the explanation kind existed carries the forge "typed
 * by hand" code deliverable (the draft was forced to it); it reads as the explanation it always was. A deliverable the
 * learner edited is left alone.
 */
export function deliverableOf(t: Pick<Ticket, 'kind' | 'session' | 'brief'>, brief: Pick<Brief, 'deliverable'> | undefined = t.brief): BriefDeliverable | null {
  const d = brief?.deliverable
  if (!d) return null
  if (isTeachback(t) && d.kind === 'code' && d.prompt === FORGE_DELIVERABLE_PROMPT) return { kind: 'explanation', prompt: TEACHBACK_DELIVERABLE_PROMPT }
  return d
}

/** A fresh draft from a job's output (the split proposal is kept for the Split dialog). */
export function toBrief(out: BriefOutput): Brief {
  const { split, ...rest } = out
  return { ...rest, status: 'draft', source: 'ai', ...(split ? { splitSuggestion: split } : {}) }
}

/**
 * Whether a brief is drafted for this card at all. A split card is never drafted (ruling 25 R3): the parent already
 * has the brief the split was made from, and its parts inherit it (ruling 20 S3). A draft on a part would hide the
 * parent's brief on its Do screen and change its minutes, so the parts would stop adding up to the parent.
 */
export const isDraftable = (t: Pick<Ticket, 'children' | 'childOf'>): boolean => !isContainer(t) && !isPart(t)

/** Sprint N's cards that still need a draft, in plan order (unfinished, live, never a split card or one of its parts). */
export function sprintDraftQueue(tickets: Ticket[], sprint: number): Ticket[] {
  return tickets
    .filter(t => !t.archived && t.sprint === sprint && t.status !== 'done' && !t.brief && isDraftable(t))
    .sort((a, b) => a.order - b.order)
}

/** A learning card with a brief and questions is finished through its check, never by a tick (briefs Addendum 3). */
export function needsCheck(t: Pick<Ticket, 'brief' | 'status' | 'kind' | 'session'>): boolean {
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

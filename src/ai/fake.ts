// Deterministic fake provider (spec §4.6). The outputs are pinned by the acceptance contracts
// (_common rules 2, 7, 8; design §7; projects §1; banks §5.5; ladder §9). Never change a string
// here without the controller updating the contracts. Only client.ts calls this, and only when
// the provider is 'fake'.
import { TEACHBACK_DELIVERABLE_PROMPT } from './forgeConst'
import {
  AiJobError, isAiErrorCode,
  type AiErrorCode, type BriefContext, type BriefOutput, type CheckContext, type CheckOutput, type ReviewContext, type ReviewOutput, type ClassifyContext, type ClassifyOutput, type DiagramJson, type GradeContext, type GradeOutput, type HintContext,
  type InterviewContext, type InterviewItem, type InterviewOutput, type JobName, type JobOutput, type JobRequest,
  type SolutionOutput, type SrAlgoJson, type SrAlgoStep, type SuggestSlideContext, type SuggestSlideOutput,
} from './types'

export const FAKE_FAIL_KEY = 'dojo-ai-fake-fail'
export const FAKE_DELAY_KEY = 'dojo-ai-fake-delay-ms'
export const FAIL_CLASSIFY_TRIGGER = '__fail_classify__'
export const fakeVariantKey = (job: JobName) => `dojo:fake-ai-${job}`

export interface FakeHooks { variant: string; fail: AiErrorCode | null; delayMs: number }
type StorageLike = Pick<Storage, 'getItem'>

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Read on every call (ladder §2.5): a variant, a fail hook (beats the variant) and a delay. Never throws. */
export function readFakeHooks(job: JobName, storage: StorageLike | null = defaultStorage(), ticketId?: string): FakeHooks {
  const get = (k: string): string | null => {
    try {
      return storage?.getItem(k) ?? null
    } catch {
      return null
    }
  }
  const variant = get(fakeVariantKey(job))?.trim() || 'default'
  let fail: AiErrorCode | null = null
  const rawFail = get(FAKE_FAIL_KEY)?.trim()
  if (rawFail) {
    const [target, code] = rawFail.split(':')
    // briefs Addendum 1 Q9: '<job>@<ticketId>' fails that one ticket's call only
    if (target === '*' || target === job || (ticketId !== undefined && target === `${job}@${ticketId}`)) fail = code && isAiErrorCode(code) ? code : 'claude_failed'
  }
  const rawDelay = get(FAKE_DELAY_KEY)?.trim() ?? ''
  const delayMs = /^\d+$/.test(rawDelay) ? Number(rawDelay) : 0
  return { variant, fail, delayMs }
}

const A = [3, 1, 4, 1, 5]
export const FAKE_PICTURE_STEPS: readonly SrAlgoStep[] = [
  { op: 'pointer', name: 'i', s: 'a', i: 0, line: 0, say: 'Start at index 0: best is 3.' },
  { op: 'mark', s: 'a', i: 0, state: 'current', line: 0, say: 'Index 0 is the best so far.' },
  { op: 'pointer', name: 'i', s: 'a', i: 1, line: 1, say: 'Move i to index 1.' },
  { op: 'compare', s: 'a', i: 0, j: 1, line: 2, say: 'Compare best 3 with 1.' },
  { op: 'mark', s: 'a', i: 1, state: 'visited', line: 2, say: '1 is not larger: best stays at index 0.' },
  { op: 'pointer', name: 'i', s: 'a', i: 2, line: 1, say: 'Move i to index 2.' },
  { op: 'compare', s: 'a', i: 0, j: 2, line: 2, say: 'Compare best 3 with 4.' },
  { op: 'mark', s: 'a', i: 2, state: 'current', line: 3, say: '4 is larger: best moves to index 2.' },
  { op: 'pointer', name: 'i', s: 'a', i: 3, line: 1, say: 'Move i to index 3.' },
  { op: 'compare', s: 'a', i: 2, j: 3, line: 2, say: 'Compare best 4 with 1.' },
  { op: 'mark', s: 'a', i: 3, state: 'visited', line: 2, say: '1 is not larger: best stays at index 2.' },
  { op: 'pointer', name: 'i', s: 'a', i: 4, line: 1, say: 'Move i to index 4.' },
  { op: 'compare', s: 'a', i: 2, j: 4, line: 2, say: 'Compare best 4 with 5.' },
  { op: 'mark', s: 'a', i: 4, state: 'current', line: 3, say: '5 is larger: best moves to index 4.' },
  { op: 'mark', s: 'a', i: 4, state: 'done', line: 4, say: 'Answer for this small input: 5 at index 4.' },
]

/** design contract §7 / _common rule 8: the fixed 4-node reference. */
export const FAKE_DIAGRAM: DiagramJson = {
  layout: 'layered',
  nodes: [
    { id: 'client', kind: 'browser', label: 'Client' },
    { id: 'gw', kind: 'gateway', label: 'Gateway' },
    { id: 'svc', kind: 'service', label: 'Service' },
    { id: 'store', kind: 'nosql', label: 'Counters' },
  ],
  links: [
    { from: 'client', to: 'gw', kind: 'sync' },
    { from: 'gw', to: 'svc', kind: 'sync' },
    { from: 'svc', to: 'store', kind: 'write' },
  ],
  zones: [],
  flows: [{ path: ['client', 'gw', 'svc', 'store'], packet: 'request', label: 'hot path' }],
}

export const FAKE_INTERVIEW_ITEMS: readonly Omit<InterviewItem, 'note'>[] = [
  { item: 'Requirements and numbers', points: 4 },
  { item: 'API and data model', points: 2 },
  { item: 'High-level design that meets the numbers', points: 3 },
  { item: 'Two deep dives with real trade-offs', points: 4 },
  { item: 'Failure modes and operations', points: 2 },
]

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

function picture(id: string): SrAlgoJson {
  return {
    title: `[fake:picture] Max scan for ${id}`,
    complexity: 'O(n)',
    structures: { a: { type: 'array', values: [...A] } },
    code: ['best = 0', 'for i in 1..n-1', '  if a[i] > a[best]', '    best = i', 'return best'],
    steps: clone([...FAKE_PICTURE_STEPS]),
  }
}

/** Variants (localStorage `dojo:fake-ai-interview`), UAT cu-7 P2-1: 'closing-done' answers a turn with `done:true` and a line (repairable: the
 * real model did this on the closing turn), 'malformed' answers with a grade shape that has nothing to repair. */
function interview(id: string, ctx: InterviewContext, variant = 'default'): InterviewOutput {
  if (variant === 'malformed') return (ctx.final ? { done: true, score: 'high', perItem: 'none' } : { done: true }) as unknown as InterviewOutput
  if (variant === 'closing-done' && !ctx.final) return { say: `[fake:interview] Turn ${ctx.turn} for ${id}: thanks, that is the interview.`, done: true } as unknown as InterviewOutput
  if (!ctx.final) return { say: `[fake:interview] Turn ${ctx.turn} for ${id}: which trade-off did you choose, and why?`, done: false }
  const note = `[fake:interview] ${id}`
  return {
    done: true,
    score: 15,
    perItem: FAKE_INTERVIEW_ITEMS.map(p => ({ ...p, note })),
    oneThingToStudy: note,
    deepDives: [2, 1, 2, 1],
    lenses: { load: 2, data: 1, consistency: 1, failure: 1, latency: 1, cost: 0, evolution: 1 },
  }
}

function grade(id: string, variant: string, ctx: GradeContext = {}): GradeOutput {
  // UAT cu-5 P2-2: a written teach-back is judged as prose; the fake never mentions a commit, a diff or a measurement for it
  if (ctx.deliverableKind === 'explanation') {
    if (variant === 'low') {
      return { score: 2, max: 5, passed: false, feedback: [`[fake:grade] ${id}: the explanation names the parts but not what each is for.`], missing: ['[fake:grade] a worked example'] }
    }
    return { score: 4, max: 5, passed: true, feedback: [`[fake:grade] ${id}: the explanation names the mechanism in the learner's own words.`], missing: [] }
  }
  if (variant === 'low') {
    return {
      score: 2, max: 5, passed: false,
      feedback: [`[fake:grade] ${id} runs but has no measurement.`],
      missing: ['[fake:grade] a measurement or test'], commitFound: true,
    }
  }
  return {
    score: 4, max: 5, passed: true,
    feedback: [`[fake:grade] ${id} runs, is hand-written, and is measured.`], missing: [], commitFound: true,
  }
}

function solution(id: string): SolutionOutput {
  return {
    approach: `[fake:solution] Approach for ${id}: keep one invariant and scan once.`,
    pseudocode: ['best = first item', 'for each item', '  if item beats best: best = item', 'return best'],
    complexity: 'O(n) time · O(1) space',
    quiz: [
      { q: 'What stays true after every step?', a: 'best holds the answer so far' },
      { q: 'How many passes?', a: 'one' },
      { q: 'How much extra space?', a: 'O(1)' },
    ],
  }
}

function suggestSlide(ctx: SuggestSlideContext): SuggestSlideOutput {
  const n = Number.isFinite(ctx.count) ? Math.max(0, Math.min(ctx.tickets.length, Math.floor(ctx.count))) : 0
  return {
    slide: ctx.tickets.slice(0, n).map(t => ({ id: t.id, reason: `[fake:suggest_slide] Slide ${t.id}: fewest slides so far.` })),
    keep: ctx.tickets.slice(n).map(t => ({ id: t.id, reason: `[fake:suggest_slide] Keep ${t.id}: fits this sprint.` })),
  }
}

function classify(id: string): ClassifyOutput {
  return {
    title: 'Fake classified item',
    pattern: 'SLIDING WINDOW',
    difficulty: 'M',
    source: 'Text',
    note: `[fake:classify] Suggested SLIDING WINDOW · M for ${id}.`,
    approaches: [
      { name: 'Brute force', pattern: null, complexity: 'O(n²)' },
      { name: 'Sliding window', pattern: 'SLIDING WINDOW', complexity: 'O(n)', libraryKey: 'slidingWindow', best: true },
    ],
  }
}

/** "Set the routine" -> "set-the-routine" (the fake brief's link, contracts/briefs.md). */
export function slugOf(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

/** contracts/briefs.md "Fake AI outputs": answers only for a plain (non-forge) task; everything else is code, except a teach-back card (an explanation, UAT cu-5 P2-2). */
function brief(title: string, ctx: BriefContext, variant = 'default'): BriefOutput {
  const answers = (ctx.learning ?? (ctx.kind === 'watch' || ctx.kind === 'read')) && !ctx.forge
  const out = briefDefault(title, ctx, answers)
  // Addendum 4: `invalid` misses its steps (unusable); `forge-code` carries a fenced block in step 1 (a forge brief must not)
  if (variant === 'invalid') { const { steps: _s, ...rest } = out; return rest as unknown as BriefOutput }
  if (variant === 'forge-code') return { ...out, steps: [{ ...out.steps[0], text: `${out.steps[0].text}\n\`\`\`py\nprint('hello')\n\`\`\`` }, ...out.steps.slice(1)], deliverable: { kind: 'code', prompt: 'Paste your code, typed by hand' }, questions: [] }
  return out
}

function briefDefault(title: string, ctx: BriefContext, answers: boolean): BriefOutput {
  // UAT cu-5 P2-2: a teach-back card hands in an explanation, not code
  const teachback = ctx.teachback === true && !answers
  return {
    goal: `Understand ${title}`,
    steps: [
      { text: `Open the material for ${title}`, url: `https://example.com/${slugOf(title)}` },
      { text: 'Write three sentences on what you learned' },
    ],
    minutes: 60,
    dayType: 'focus',
    learn: [`Key idea of ${title}`],
    outcome: `You can explain ${title} in your own words`,
    deliverable: answers
      ? { kind: 'answers', prompt: 'Answer the questions' }
      : teachback ? { kind: 'explanation', prompt: TEACHBACK_DELIVERABLE_PROMPT } : { kind: 'code', prompt: 'Paste your code, typed by hand' },
    questions: answers
      ? [
          { id: 'q1', kind: 'open', q: `Explain ${title} in your own words`, keyIdeas: [title] },
          { id: 'q2', kind: 'mcq', q: `Which is ${title}?`, choices: [title, `Not ${title}`], correct: 0 },
        ]
      : [],
  }
}

function check(title: string, ctx: CheckContext): CheckOutput {
  return {
    results: ctx.questions.map(q => {
      if (q.kind === 'mcq') {
        const ok = q.choice !== undefined && q.choice === q.correct
        return { id: q.id, verdict: ok ? 'pass' : 'fail', correction: ok ? '' : `The answer is "${q.choices?.[q.correct ?? 0] ?? title}"`, pointer: ok ? '' : 'Step 1' }
      }
      const ok = (q.answer ?? '').toLowerCase().includes(title.toLowerCase())
      return { id: q.id, verdict: ok ? 'pass' : 'fail', correction: ok ? '' : `Mention ${title}`, pointer: ok ? '' : 'Step 1' }
    }),
  }
}

function reviewSprint(ctx: ReviewContext): ReviewOutput {
  const s = ctx.stats
  return {
    prose: `Review for Sprint ${s.sprint}: ${s.done}/${s.planned} cards done.`,
    // Controller ruling 8 S4: the fake carries items so the "Do better next sprint" list is reachable.
    doBetter: [
      `Start Sprint ${s.sprint + 1}'s hardest card on day one.`,
      'Close each session with a written next step.',
    ],
  }
}

/** Pure: the fake output for one job and variant. Throws AiJobError for 'error' and input triggers. */
export function fakeOutput<J extends JobName>(job: J, req: JobRequest<J>, variant = 'default'): JobOutput<J> {
  if (job === 'classify' && (req.context as ClassifyContext).input.includes(FAIL_CLASSIFY_TRIGGER)) {
    throw new AiJobError('claude_failed', 'fake classify failure')
  }
  if (variant === 'error') throw new AiJobError('claude_failed', `fake ${job} unavailable`)
  const id = req.ticket?.id ?? 'new item'
  let out: unknown
  switch (job) {
    case 'hint':
      out = { hint: `[fake:hint] Level ${(req.context as HintContext).level} nudge for ${id}: what stays true after every step?` }
      break
    case 'picture': out = picture(id); break
    case 'diagram': out = clone(FAKE_DIAGRAM); break
    case 'interview': out = interview(id, req.context as InterviewContext, variant); break
    case 'grade': out = grade(id, variant, req.context as GradeContext); break
    case 'solution': out = solution(id); break
    case 'suggest_slide': out = suggestSlide(req.context as SuggestSlideContext); break
    case 'classify': out = classify(id); break
    case 'brief': out = brief(req.ticket?.title ?? id, req.context as BriefContext, variant); break
    case 'check': out = check(req.ticket?.title ?? id, req.context as CheckContext); break
    case 'review_sprint': out = reviewSprint(req.context as ReviewContext); break
    default: throw new AiJobError('unknown_job', `fake ${String(job)} unavailable`)
  }
  return out as JobOutput<J>
}

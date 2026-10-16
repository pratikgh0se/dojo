// Deterministic fake provider (spec §4.6). The outputs are pinned by the acceptance contracts
// (_common rules 2, 7, 8; design §7; projects §1; banks §5.5; ladder §9). Never change a string
// here without the controller updating the contracts. Only client.ts calls this, and only when
// the provider is 'fake'.
import { coachTurn, turnTopic, type CoachTopic } from './coachPlan'
import {
  AiJobError, isAiErrorCode,
  type AiErrorCode, type BankMoreContext, type BankMoreOutput, type BriefContext, type LabReviewContext, type LabReviewOutput, type PortfolioDraftContext, type PortfolioDraftOutput, type BriefOutput, type CheckContext, type CheckOutput, type ClassifyContext, type ClassifyOutput, type DiagramJson, type GradeContext, type GradeOutput, type HintContext,
  type InterviewContext, type InterviewFinal, type InterviewItem, type InterviewOutput, type JobName, type JobOutput, type JobRequest,
  type SolutionOutput, type SrAlgoJson, type SrAlgoStep,
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

const FAKE_QUESTIONS: Record<CoachTopic, readonly string[]> = {
  requirements: ['Before drawing anything: who are the users and what do they do most', 'What are the two or three things this must do, and what is clearly out of scope', 'Which non-functional goal matters most here, and how would you tell it was met'],
  estimates: ['What numbers will you design to, and how did you get them', 'How much data does that produce in a year, and where does it sit'],
  design: ['Which part of the design carries the most risk, and why', 'Where does state live, and who owns it'],
  tradeoffs: ['What did you give up with your main choice, and what would make you change it', 'What breaks first as the load grows, and how would you notice', 'Which decision would you test first, and what result would change your mind'],
  challenge: ['You settled on one approach. What happens to it when traffic doubles', 'One of your numbers could be off by ten times. Which one hurts most', 'Pick the component you trust least. What happens when it fails'],
}
const FAKE_HINTS: Record<CoachTopic, string> = {
  requirements: 'Think of one user and one action. What is the first thing they do',
  estimates: 'Start from a single number you can defend. What would you multiply it by',
  design: 'Pick one box you drew. What does it hold and who talks to it',
  tradeoffs: 'Name one thing your choice makes harder. Who feels it first',
  challenge: 'Take the smallest version of the change. What is the first thing that slows down',
}

/** A ticket title or id goes into one chat line that has exactly one `?` and never the word interview (DESIGN-45, GLOBAL-01). */
const speakable = (s: string) => s.replace(/\?/g, '').replace(/\binterview\w*/gi, 'session').replace(/\s+/g, ' ').trim()

/** Variants (localStorage `dojo:fake-ai-interview`), UAT cu-7 P2-1: 'closing-done' answers a turn with `done:true` and a line (repairable: the
 * real model did this on the closing turn), 'malformed' answers with a grade shape that has nothing to repair. */
function interview(id: string, title: string, ctx: InterviewContext, variant = 'default'): InterviewOutput {
  if (variant === 'malformed') return (ctx.final ? { done: true, score: 'high', perItem: 'none' } : { done: true }) as unknown as InterviewOutput
  if (variant === 'closing-done' && !ctx.final) return { say: `[fake:partner] Turn ${ctx.turn} for ${speakable(id)}: thanks, that is the session.`, done: true } as unknown as InterviewOutput
  if (ctx.final) return sessionFinal(id, variant, ctx.design)
  const topic = turnTopic(coachTurn(ctx.turn))
  const qs = FAKE_QUESTIONS[topic]
  const name = `${speakable(title)} (${speakable(id)})`
  if (ctx.hint) return { say: `[fake:partner] Hint for ${speakable(id)}: ${FAKE_HINTS[topic]}?`, done: false }
  return { say: `[fake:partner] ${name}, turn ${ctx.turn}: ${qs[ctx.turn % qs.length]}?`, done: false }
}

/** The final session grade, from the interview job (final) and the grade job (sessionGrade). Variant `findings` adds three inconsistencies; `malformed` is unusable. */
/** The labels of the drawn nodes in a design digest ("nodes:" lines, `- Label [kind] ...`), in drawn order: the fake cites the real canvas. */
function digestNodeLabels(design: string | undefined): string[] {
  if (!design) return []
  const out: string[] = []
  let inNodes = false
  for (const l of design.split('\n')) {
    if (l === 'nodes:') { inNodes = true; continue }
    if (inNodes && !l.startsWith('- ')) break
    const m = inNodes ? /^- (.+?) \[[^\]]*\]/.exec(l) : null
    if (m) out.push(m[1])
  }
  return out
}
/** The notes section each rubric item reads most, for the fake's evidence. */
const FAKE_NOTE_FOR_ITEM = ['requirements', 'api', 'assumptions', 'tradeoffs', 'open'] as const

function sessionFinal(id: string, variant: string, design?: string): InterviewFinal {
  // variant `malformed` (grade job, UAT cu-7 P2-1): a grade shape that has nothing to repair
  if (variant === 'malformed') return { done: true, score: 'high', perItem: 'none' } as unknown as InterviewFinal
  const note = `[fake:partner] ${speakable(id)}`
  const labels = digestNodeLabels(design)
  const perItem = FAKE_INTERVIEW_ITEMS.map((p, i) => ({
    ...p, note,
    feedback: `${note}: ${p.item.toLowerCase()} scored ${p.points}. The notes and the diagram name what is covered and what is still missing.`,
    evidence: [
      { source: 'notes' as const, target: FAKE_NOTE_FOR_ITEM[i] },
      ...(labels.length > 0 ? [{ source: 'diagram' as const, target: labels[i % labels.length] }] : []),
    ],
  }))
  return {
    done: true,
    score: perItem.reduce((a, p) => a + p.points, 0),
    perItem,
    oneThingToStudy: note,
    deepDives: [2, 1, 2, 1],
    lenses: { load: 2, data: 1, consistency: 1, failure: 1, latency: 1, cost: 0, evolution: 1 },
    stronger: [`${note}: names a partition key and shows how many partitions the numbers call for.`, `${note}: gives every box a line in the notes with its API call and its failure case.`],
    missed: [
      { topic: 'partition key', question: `${note}: what makes a good partition key for a write queue?`, answer: `${note}: it spreads writes evenly and keeps the items that need an order on one partition.` },
      { topic: 'tile fetch API', question: `${note}: how does a client fetch one tile, and who writes it?`, answer: `${note}: a read call by tile id, written by the service that renders it.` },
      { topic: 'conflict rule', question: `${note}: what does last-writer-wins cost a user?`, answer: `${note}: the earlier edit is lost without a warning, so say who loses.` },
    ],
    ...(variant === 'findings' ? {
      inconsistencies: [
        `${note}: the notes plan 20,000 requests a second but the diagram has one unreplicated database.`,
        `${note}: the data model has a table no drawn store holds.`,
        `${note}: the API lists no call for the box labelled Render engine.`,
      ],
    } : {}),
  }
}

function grade(id: string, variant: string, ctx: GradeContext = {}): GradeOutput {
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

/** contracts/briefs.md "Fake AI outputs": answers for a watch or read ticket; everything else hands in code. */
function brief(title: string, ctx: BriefContext, variant = 'default'): BriefOutput {
  const answers = ctx.learning ?? (ctx.kind === 'watch' || ctx.kind === 'read')
  const out = briefDefault(title, ctx, answers)
  // `invalid` misses its steps (unusable)
  if (variant === 'invalid') { const { steps: _s, ...rest } = out; return rest as unknown as BriefOutput }
  return out
}

function briefDefault(title: string, _ctx: BriefContext, answers: boolean): BriefOutput {
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
      : { kind: 'code', prompt: 'Paste your code, typed by hand' },
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

/** R1 W6 (BANK-19): five fixed, valid questions about the node in the context. The node title is in every question so two nodes never repeat. */
function bankMore(ctx: BankMoreContext): BankMoreOutput {
  const t = ctx.nodeTitle || ctx.node
  const mk = (type: BankMoreOutput['questions'][number]['type'], difficulty: number, k: number): BankMoreOutput['questions'][number] => ({
    type, difficulty,
    question: `[fake:bank_more] ${t}, question ${k}: what is the ${type === 'estimate' ? 'rough size' : type === 'tradeoff' ? 'main trade-off' : type === 'design' ? 'first design move' : 'key idea'} here?`,
    answer: `For ${t}, a strong answer names the ${type === 'estimate' ? 'quantity, the unit and the order of magnitude' : type === 'tradeoff' ? 'two options and what each costs' : type === 'design' ? 'components, the data they hold and the failure to plan for' : 'idea in one sentence and one example'}. It then says why it matters in practice.`,
    checklist: [`Names the idea for ${t}`, 'Gives a concrete example or number', 'Says why it matters'],
  })
  return { questions: [mk('concept', 2, 1), mk('estimate', 3, 2), mk('tradeoff', 3, 3), mk('design', 4, 4), mk('concept', 1, 5)] }
}

/**
 * The `lab_review` job (contracts README, "Fake AI provider"). Variant (localStorage `dojo:fake-ai-lab_review`): `pass` (default, an
 * unknown name too), `pass-weak`, `borderline`, `not-yet`, `fabricated`, `malformed`, `invalid`. Scores repeat by item index over the four listed.
 * A real quote is the first line of the bundle's WRITEUP.md that is not empty and does not start with #; a made-up quote is not in
 * the work. Every reply also claims `percent: 100, passed: true`, which the app must ignore.
 */
const MADE_UP_QUOTE = 'This sentence is not in the work.'
const LAB_SCORES: Record<string, readonly number[]> = {
  pass: [3, 2, 3, 2], 'pass-weak': [3, 3, 3, 1], borderline: [3, 2, 2, 1], 'not-yet': [1, 0, 1, 1], fabricated: [3, 2, 3, 0], malformed: [3, 2, 3, 0], invalid: [3, 2, 3, 2],
}
function realQuote(writeup: string): { quote: string; file: string; line: number } | null {
  const lines = writeup.split('\n')
  const i = lines.findIndex(l => l.trim() !== '' && !l.trimStart().startsWith('#'))
  return i < 0 ? null : { quote: lines[i].replace(/\r$/, ''), file: 'WRITEUP.md', line: i + 1 }
}
function labReview(ctx: LabReviewContext, variant = 'default'): LabReviewOutput {
  const v = variant in LAB_SCORES ? variant : 'pass'
  const rubric = ctx?.bundle?.rubric ?? []
  const real = realQuote(ctx?.bundle?.writeup ?? '')
  const madeUp = { quote: MADE_UP_QUOTE, file: 'WRITEUP.md', line: 1 }
  const items = rubric.map((r, i) => {
    const score = LAB_SCORES[v][i % 4]
    let evidence = score >= 2 && real ? [real] : []
    if (v === 'fabricated') evidence = [[real], [real, madeUp], [madeUp], []][i % 4].filter((e): e is NonNullable<typeof e> => e !== null)
    if (v === 'malformed') {
      // r2 adds a 401-character quote, r3 has a real quote with no line (LAB-71)
      const noLine = real ? { quote: real.quote, file: real.file } : null
      evidence = [[real], [real, { quote: 'x'.repeat(401), file: 'WRITEUP.md', line: 1 }], [noLine], []][i % 4].filter((e): e is NonNullable<typeof e> => e !== null) as typeof evidence
    }
    return { id: r.id, score, evidence, stronger: `[fake:review] A stronger answer for ${r.id} adds one concrete detail.` }
  })
  // invalid: the first item twice, and a score of 7 on the copy
  const listed = v === 'invalid' && items.length > 0 ? [items[0], { ...items[0], score: 7 }, ...items.slice(1)] : items
  return { items: listed, summary: `[fake:review] Reviewed ${rubric.length} items.`, percent: 100, passed: true } as LabReviewOutput
}

/**
 * The `portfolio_draft` job (portfolio.md, "Fake AI for portfolio_draft"): a fixed template over the lab title (the ticket title), the
 * number of journal rows `n` and the number of stronger texts `m`. A write-up LINE `FAKE-LONG` makes the LinkedIn reply 40 numbered
 * sentences (1,759 characters); a line `FAKE-INVALID` makes both kinds return nothing usable (the invalid-reply failure).
 */
const hasLine = (text: unknown, marker: string): boolean => typeof text === 'string' && text.split(/\r?\n/).some(l => l.trim() === marker)
function portfolioDraft(title: string, ctx: PortfolioDraftContext): PortfolioDraftOutput {
  const writeup = ctx?.writeup
  if (hasLine(writeup, 'FAKE-INVALID')) return { text: '' }
  const n = Array.isArray(ctx?.journal) ? ctx.journal.length : 0
  const m = Array.isArray(ctx?.stronger) ? ctx.stronger.length : 0
  if (ctx?.kind === 'linkedin') {
    if (hasLine(writeup, 'FAKE-LONG')) return { text: Array.from({ length: 40 }, (_, i) => `Sentence ${String(i + 1).padStart(2, '0')} of the fake long LinkedIn post.`).join(' ') }
    return { text: `Fake LinkedIn draft for ${title}. Built from the write-up and ${m} stronger versions.` }
  }
  return { text: `# ${title}\n\nFake article draft built from the write-up, ${n} journal entries and ${m} stronger versions.` }
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
    case 'interview': out = interview(id, req.ticket?.title ?? id, req.context as InterviewContext, variant); break
    case 'grade': out = (req.context as GradeContext)?.sessionGrade ? sessionFinal(id, variant, (req.context as GradeContext).design) : grade(id, variant, req.context as GradeContext); break
    case 'solution': out = solution(id); break
    case 'classify': out = classify(id); break
    case 'brief': out = brief(req.ticket?.title ?? id, req.context as BriefContext, variant); break
    case 'check': out = check(req.ticket?.title ?? id, req.context as CheckContext); break
    case 'bank_more': out = bankMore(req.context as BankMoreContext); break
    case 'lab_review': out = labReview(req.context as LabReviewContext, variant); break
    case 'portfolio_draft': out = portfolioDraft(req.ticket?.title ?? id, req.context as PortfolioDraftContext); break
    default: throw new AiJobError('unknown_job', `fake ${String(job)} unavailable`)
  }
  return out as JobOutput<J>
}

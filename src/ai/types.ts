// The AI job contract shared by every chain (spec §4; AI.md "Jobs"; ladder contract §6, §7.3).
// No React, no Dexie. data/types.ts imports the engine/output shapes from here (type-only).
import type { AtlasPattern } from '../content/patterns'
import type { Difficulty, Kind, Link } from '../data/types'

export const JOB_NAMES = [
  'hint', 'picture', 'diagram', 'interview', 'grade', 'solution', 'suggest_slide', 'classify', 'brief', 'check', 'review_sprint',
] as const
export type JobName = (typeof JOB_NAMES)[number]
export type ProviderName = 'fake' | 'helper'

export type Score012 = 0 | 1 | 2
/** TRACKING §1 lenses, in radar order. */
export const LENSES = ['load', 'data', 'consistency', 'failure', 'latency', 'cost', 'evolution'] as const
export type Lens = (typeof LENSES)[number]

// ---- engine JSON (lab/algo.js, lab/algo2.js, lab/diagram.js headers) ----
export interface SrAlgoStep { op: string; say: string; line?: number; vars?: Record<string, unknown>; [key: string]: unknown }
export interface SrAlgoStructure { type: string; [key: string]: unknown }
export interface SrAlgoJson {
  title: string
  complexity?: string
  structures: Record<string, SrAlgoStructure>
  code?: string[]
  steps: SrAlgoStep[]
}
export interface DiagramNode { id: string; kind: string; label: string; sub?: string; state?: string; x?: number; y?: number }
export interface DiagramLink { from: string; to: string; kind: string; label?: string }
export interface DiagramZone { label: string; kind: string; nodes: string[] }
export interface DiagramFlow { path: string[]; packet?: string; label?: string }
export interface DiagramJson {
  layout: 'layered' | 'grid' | 'manual'
  nodes: DiagramNode[]
  links: DiagramLink[]
  zones?: DiagramZone[]
  flows?: DiagramFlow[]
}

// ---- shared shapes ----
/** TRACKING §3: 2–4 ways to solve a problem, brute → best; `best` is the starred one. */
export interface Approach { name: string; pattern: AtlasPattern | null; complexity: string; libraryKey?: string; best?: boolean }
/** Ladder contract §7.3 `ticket`. For grade on an artifact, id is the artifact id; for designs, the design id. */
export interface AiTicket {
  id: string
  title: string
  text?: string
  track: 'dsa' | 'design' | 'ai' | 'interview'
  pattern?: string | null
  difficulty?: Difficulty
  links?: Link[]
}
export interface SlideCandidate { id: string; title: string; track: string; estMin: number; difficulty?: Difficulty; slidCount: number }

// ---- per-job context and output ----
export interface HintContext { level: 1 | 2; attemptLog?: string }
export interface HintOutput { hint: string }

export interface PictureContext { attemptLog?: string; language?: 'python' }

export interface DiagramContext { deepDives: string[]; refs?: Link[] }

/** One transcript line the interview job sees (integration spec §2.5); `you` is the candidate. */
export interface TranscriptMessage { from: 'interviewer' | 'you'; text: string }
export interface InterviewContext { turn: number; answers: string[]; deepDives: string[]; final?: boolean; transcript?: TranscriptMessage[] }
export interface InterviewTurn { say: string; done: false }
export interface InterviewItem { item: string; points: number; note: string }
/** Design contract §7: the final turn grades the rubric (0–20), the 4 deep dives and the 7 lenses. */
export interface InterviewFinal {
  done: true
  score: number
  perItem: InterviewItem[]
  oneThingToStudy: string
  deepDives: [Score012, Score012, Score012, Score012]
  lenses: Record<Lens, Score012>
}
export type InterviewOutput = InterviewTurn | InterviewFinal

export interface GradeContext {
  proofNote?: string
  repoUrl?: string
  repoPath?: string
  commit?: string
  commitSummary?: string
  stage?: number
  stageTitle?: string
  rubric?: string
  /** UAT cu-5 P2-2: 'explanation' grades written prose (a teach-back) against the rubric; there is no repo, commit or diff to look for */
  deliverableKind?: DeliverableKind
}
/** AI.md "grade" + projects contract §1: pass iff score ≥ 3; `commitFound` = the helper read the commit. */
export interface GradeOutput { score: number; max: 5; passed: boolean; feedback: string[]; missing: string[]; commitFound?: boolean }

export interface SolutionContext { gave_up: true; attemptLog?: string; picture?: SrAlgoJson }
export interface QuizItem { q: string; a: string }
export interface SolutionOutput { approach: string; pseudocode: string[]; complexity: string; quiz: QuizItem[] }

export interface SuggestSlideContext { tickets: SlideCandidate[]; count: number; pace?: number; nextSprint?: SlideCandidate[] }
export interface SlideReason { id: string; reason: string }
export interface SuggestSlideOutput { slide: SlideReason[]; keep: SlideReason[] }

export interface ClassifyContext { input: string }
export interface ClassifyOutput {
  title: string
  pattern: AtlasPattern
  difficulty: Difficulty
  source: string
  /** banks contract §5.5: the suggestion's note line */
  note?: string
  approaches?: Approach[]
}

// ---- briefs (v2 part 3): card briefs, learning checks, sprint review ----
export type DayType = 'focus' | 'light' | 'long'
export const DAY_TYPES: readonly DayType[] = ['focus', 'light', 'long']
export type DeliverableKind = 'answers' | 'code' | 'artifact' | 'note' | 'explanation'
export const DELIVERABLE_KINDS: readonly DeliverableKind[] = ['answers', 'code', 'artifact', 'note', 'explanation']
export interface BriefStep { text: string; url?: string }
export interface BriefQuestion { id: string; kind: 'open' | 'mcq'; q: string; choices?: string[]; keyIdeas?: string[]; correct?: number }
export interface BriefDeliverable { kind: DeliverableKind; prompt: string }
export interface BriefSplitPart { title: string; minutes: number }
/** What the `brief` job returns; the stored Brief adds status, source and linkCheck (data/types). */
export interface BriefOutput {
  goal: string
  steps: BriefStep[]
  minutes: number
  dayType: DayType
  learn: string[]
  outcome: string
  deliverable: BriefDeliverable
  questions: BriefQuestion[]
  /** optional: propose splitting a big item into sessions of 45-90 minutes each */
  split?: BriefSplitPart[]
}
/** `kind` is the ticket kind; `forge` = an AI-track or stage ticket (the model never writes its code). */
export interface BriefContext { kind: Kind; forge: boolean; /** watch/read, or a stage whose session is watch: answers deliverable and questions */ learning?: boolean; /** a stage whose session is teachback: an explanation deliverable (UAT cu-5 P2-2) */ teachback?: boolean; estMin: number; sprint: number; session?: string; stage?: number }

export type CheckVerdict = 'pass' | 'partial' | 'fail'
export interface CheckQuestionInput { id: string; kind: 'open' | 'mcq'; q: string; answer?: string; choice?: number; choices?: string[]; keyIdeas?: string[]; correct?: number }
export interface CheckContext { questions: CheckQuestionInput[] }
export interface CheckResult { id: string; verdict: CheckVerdict; correction: string; pointer: string }
export interface CheckOutput { results: CheckResult[] }

/** The numbers are computed in code (rules/review.ts); the job only writes the prose. */
export interface ReviewStats {
  sprint: number
  planned: number
  done: number
  focusDays: string[]
  longestStreak: number
  gaps: string[]
  slipped: { id: string; title: string; rolled: number }[]
  redoPassRate: number | null
  checkPassRate: number | null
}
export interface ReviewContext { stats: ReviewStats }
/** doBetter: the "Do better next sprint" items (ui-progress P1 #9; Controller ruling 8 S4). Optional: older reviews have none. */
export interface ReviewOutput { prose: string; doBetter?: string[] }

export interface Jobs {
  hint: { context: HintContext; output: HintOutput }
  picture: { context: PictureContext; output: SrAlgoJson }
  diagram: { context: DiagramContext; output: DiagramJson }
  interview: { context: InterviewContext; output: InterviewOutput }
  grade: { context: GradeContext; output: GradeOutput }
  solution: { context: SolutionContext; output: SolutionOutput }
  suggest_slide: { context: SuggestSlideContext; output: SuggestSlideOutput }
  classify: { context: ClassifyContext; output: ClassifyOutput }
  brief: { context: BriefContext; output: BriefOutput }
  check: { context: CheckContext; output: CheckOutput }
  review_sprint: { context: ReviewContext; output: ReviewOutput }
}
export type TicketOptionalJob = 'classify' | 'suggest_slide' | 'review_sprint'
export type JobContext<J extends JobName> = Jobs[J]['context']
export type JobOutput<J extends JobName> = Jobs[J]['output']
/** The body the helper receives: `POST /ai/:job {ticket, context}` (ladder contract §7.2). */
export interface JobRequest<J extends JobName> {
  ticket: J extends TicketOptionalJob ? AiTicket | null : AiTicket
  context: JobContext<J>
}

/**
 * Builds a `JobRequest<J>` from a job name and its already-correctly-typed context, so call sites
 * that only know `job` as the (non-literal) `JobName` union never need their own
 * `as unknown as JobRequest<...>` escape hatch. TypeScript can't distribute a `{ticket, context}`
 * object with a union-typed `context` across `JobRequest<J>`'s per-job union on its own (a known
 * "correlated unions" limitation) - `context: JobContext<J>` is what actually keeps this safe:
 * the compiler still rejects a context that doesn't match the given job.
 */
export function buildJobRequest<J extends JobName>(job: J, ticket: AiTicket | null, context: JobContext<J>): JobRequest<J> {
  return { ticket, context } as JobRequest<J>
}

// ---- errors (ladder contract §6) ----
const ah = (s: string) => `The AI helper ${s}`
const REJECTED = ah('rejected the request.')
export const AI_ERRORS = {
  helper_unreachable: { status: null, message: ah('is not running. Start it with npm run helper.') },
  claude_missing: { status: 503, message: 'Claude Code is not installed or not on PATH.' },
  /** UAT r3 P2: the CLI is there but has no login (server/claude-runner.mjs SIGNED_OUT, or `claude auth status`). */
  claude_signed_out: { status: 503, message: "Claude Code isn't signed in. Open Terminal, run `claude`, sign in, then try again." },
  timeout: { status: 504, message: ah('timed out.') },
  claude_failed: { status: 502, message: ah('failed.') },
  busy: { status: 429, message: ah('is busy. Try again in a moment.') },
  invalid_output: { status: 502, message: 'The AI returned something unusable.' },
  guardrail: { status: 403, message: 'That request is not allowed before you give up.' },
  bad_request: { status: 400, message: REJECTED },
  path_not_allowed: { status: 400, message: REJECTED },
  unknown_job: { status: 404, message: REJECTED },
  /** M2: the helper's own MAX_BODY_BYTES cap (server/helper.mjs `too_large`, HTTP 413). */
  too_large: { status: 413, message: ah('rejected it: too long. Shorten it and retry.') },
} as const satisfies Record<string, { status: number | null; message: string }>
export type AiErrorCode = keyof typeof AI_ERRORS

export function isAiErrorCode(v: unknown): v is AiErrorCode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(AI_ERRORS, v)
}

export class AiJobError extends Error {
  constructor(readonly code: AiErrorCode, message: string) {
    super(message)
    this.name = 'AiJobError'
  }
}

/** runJob never throws (AI.md "UI contract"): failures carry a code and the raw error text. */
export type JobResult<J extends JobName> =
  | { ok: true; job: J; provider: ProviderName; ms: number; output: JobOutput<J> }
  | { ok: false; job: J; provider: ProviderName; ms: number; code: AiErrorCode; error: string }

// The AI job contract shared by every chain (spec §4; AI.md "Jobs"; ladder contract §6, §7.3).
// No React, no Dexie. data/types.ts imports the engine/output shapes from here (type-only).
import type { AtlasPattern } from '../content/patterns'
import type { Difficulty, Kind, Link } from '../data/types'

export const JOB_NAMES = [
  'hint', 'picture', 'diagram', 'interview', 'grade', 'solution', 'classify', 'brief', 'check', 'bank_more',
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

// ---- per-job context and output ----
export interface HintContext { level: 1 | 2; attemptLog?: string }
export interface HintOutput { hint: string }

export interface PictureContext { attemptLog?: string; language?: 'python' }

export interface DiagramContext { deepDives: string[]; refs?: Link[] }

/** One transcript line the interview job sees (integration spec §2.5); `you` is the candidate. */
export interface TranscriptMessage { from: 'interviewer' | 'you'; text: string }
export interface InterviewContext {
  turn: number; answers: string[]; deepDives: string[]; final?: boolean; transcript?: TranscriptMessage[]
  /** designDigest of the live session: clipped to 3,000 on a turn and a Hint, 8,000 on the grade */
  design?: string
  /** a Hint request: one sharper question about the current phase, never the answer */
  hint?: boolean
}
export interface InterviewTurn { say: string; done: false }
/** F3: the notes sections an evidence chip may cite (the ids of designNotes NOTE_SECTIONS; a unit test keeps the two equal). */
export const NOTE_EVIDENCE_IDS = ['requirements', 'assumptions', 'api', 'data-model', 'tradeoffs', 'open'] as const
export type NoteEvidenceId = (typeof NOTE_EVIDENCE_IDS)[number]
/** A model's name for a notes section (id, title or any case) to the id, or null when it names none of the six. */
export function noteEvidenceId(raw: string): NoteEvidenceId | null {
  const k = raw.toLowerCase().replace(/[^a-z]/g, '')
  const by: Record<string, NoteEvidenceId> = {
    requirements: 'requirements', assumptions: 'assumptions', assumptionsandestimates: 'assumptions', estimates: 'assumptions', api: 'api',
    datamodel: 'data-model', tradeoffs: 'tradeoffs', open: 'open', openquestions: 'open',
  }
  return by[k] ?? null
}
/** F3: what a grade paragraph leans on. A notes target is a section id; a diagram target is the label of a canvas node, note, frame or table as drawn. */
export interface EvidenceRef { source: 'notes' | 'diagram'; target: string }
/** F3: a weak spot worth a review card (topic at most 5 words, question at most 25, answer at most 60). */
export interface MissedSpot { topic: string; question: string; answer: string }
/** `feedback` (at most 60 words) and `evidence` (at most 3) are F3's; a grade stored before F3 has neither and `note` stands in. */
export interface InterviewItem { item: string; points: number; note: string; feedback?: string; evidence?: EvidenceRef[] }
/** Design contract §7: the final turn grades the rubric (0–20), the 4 deep dives and the 7 lenses. */
export interface InterviewFinal {
  done: true
  score: number
  perItem: InterviewItem[]
  oneThingToStudy: string
  deepDives: [Score012, Score012, Score012, Score012]
  lenses: Record<Lens, Score012>
  /** at most 5: where the notes and the diagram disagree (flags to check, never a score on their own) */
  inconsistencies?: string[]
  /** at most 4: what a stronger version of THIS design does */
  stronger?: string[]
  /** F3, at most 3: the weak spots worth reviewing; "Keep what you missed" turns them into review cards */
  missed?: MissedSpot[]
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
  /** the design session's final grade: five rubric items out of 20, reading the chat, the notes and the diagram */
  sessionGrade?: boolean
  deepDives?: string[]
  transcript?: TranscriptMessage[]
  design?: string
}
/** AI.md "grade" + projects contract §1: pass iff score ≥ 3; `commitFound` = the helper read the commit. */
export interface GradeOutput { score: number; max: 5; passed: boolean; feedback: string[]; missing: string[]; commitFound?: boolean }

export interface SolutionContext { gave_up: true; attemptLog?: string; picture?: SrAlgoJson }
export interface QuizItem { q: string; a: string }
export interface SolutionOutput { approach: string; pseudocode: string[]; complexity: string; quiz: QuizItem[] }

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
}
/** `kind` is the ticket kind; `learning` = a watch or read ticket (answers deliverable and questions). */
export interface BriefContext { kind: Kind; learning?: boolean; estMin: number }

export type CheckVerdict = 'pass' | 'partial' | 'fail'
export interface CheckQuestionInput { id: string; kind: 'open' | 'mcq'; q: string; answer?: string; choice?: number; choices?: string[]; keyIdeas?: string[]; correct?: number }
export interface CheckContext { questions: CheckQuestionInput[] }
export interface CheckResult { id: string; verdict: CheckVerdict; correction: string; pointer: string }
export interface CheckOutput { results: CheckResult[] }

/** The stats stored on a legacy `reviews` row (Dexie table kept; the review_sprint job that wrote them is gone). */
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

// ---- bank_more (R1 W6, BANK-19): five more questions for one node of a question bank ----
export type BankMoreType = 'concept' | 'estimate' | 'tradeoff' | 'design'
/** `avoid` is the question text already in that node (so the model does not repeat it); `count` is always 5. */
export interface BankMoreContext { area: 'design' | 'ai'; node: string; nodeTitle: string; nodeAbout: string; avoid: string[]; count: 5 }
export interface BankMoreQuestion { type: BankMoreType; difficulty: number; question: string; answer: string; checklist: string[] }
export interface BankMoreOutput { questions: BankMoreQuestion[] }

export interface Jobs {
  hint: { context: HintContext; output: HintOutput }
  picture: { context: PictureContext; output: SrAlgoJson }
  diagram: { context: DiagramContext; output: DiagramJson }
  interview: { context: InterviewContext; output: InterviewOutput }
  grade: { context: GradeContext; output: GradeOutput }
  solution: { context: SolutionContext; output: SolutionOutput }
  classify: { context: ClassifyContext; output: ClassifyOutput }
  brief: { context: BriefContext; output: BriefOutput }
  check: { context: CheckContext; output: CheckOutput }
  bank_more: { context: BankMoreContext; output: BankMoreOutput }
}
export type TicketOptionalJob = 'classify' | 'bank_more'
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

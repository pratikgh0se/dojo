import type {
  AiErrorCode, Approach, BriefOutput, CheckResult, DayType, DeliverableKind, ReviewStats, ClassifyOutput, DiagramJson, GradeOutput, InterviewFinal, JobName, Lens, ProviderName,
  Score012, SolutionOutput, SrAlgoJson,
} from '../ai/types'
import type { AtlasPattern } from '../content/patterns'
import type { DesignMode, DesignNotes } from '../rules/designDigest'

export type { Approach, AtlasPattern, Lens, Score012 }

export type Track = 'ai' | 'interview'
/** 'watch' and 'read' are learning cards (briefs contract Addendum 1 Q1): the plan itself only has the first four. */
export type Kind = 'task' | 'problem' | 'design' | 'stage' | 'watch' | 'read' | 'build' | 'writeup' | 'ritual'
/** R1 flat queue: which lane a ticket belongs to. `track` stays (`ai` for path, `interview` otherwise). */
export type Lane = 'path' | 'dsa' | 'design' | 'career' | 'ritual' | 'bank'
/** R1: the lab a build ticket runs in. */
export interface LabRef { id: string; gpu: 'none' | 'free' | 'rented'; costUsd?: number }
/** `blocked` and `help` are set only by the learner on the Board (board.md); a legacy `slid` may remain on archived tickets. */
export type Status = 'todo' | 'doing' | 'blocked' | 'help' | 'done' | 'slid'
export type Difficulty = 'E' | 'M' | 'H'
/** Weekly rotation slot a stage ticket (kind:'stage') belongs to; forge AI-track rewrite only. */
export type StageSession = 'watch' | 'rebuild' | 'build' | 'teachback'
export interface ProofSlot { at: number; evidence: string }
export interface Link { label: string; url: string }

/** DATA "tickets" origin; PLATFORM "Banks". */
export type BankId = 'neetcode150' | 'blind75' | 'striver' | 'codeforces' | 'hellointerview' | 'mine'
export type TicketOrigin =
  | 'plan' | 'bank:neetcode150' | 'bank:blind75' | 'bank:striver' | 'bank:codeforces' | 'bank:hellointerview' | 'mine'
  /** briefs BR-08: a session split off a big item has its parent's id as its origin */
  | (string & {})
/** PLATFORM "Do" ladder: 1 Attempt · 2 Hint · 3 Picture · 4 Video · 5 Solution. */
export type Rung = 1 | 2 | 3 | 4 | 5
export type HelpRung = 2 | 3 | 4 | 5
/** DATA "Redo schedule": stage 0 = +3d, 1 = +10d, 2 = +30d. */
export type RedoStage = 0 | 1 | 2
export interface InterviewMessage { from: 'interviewer' | 'you'; text: string; hint?: true }
export interface InterviewTranscript { messages: InterviewMessage[]; final?: InterviewFinal }
/** AI.md "UI contract": model outputs are stored on the ticket so a second visit costs nothing. */
export interface TicketAi {
  hints?: string[]
  picture?: SrAlgoJson
  solution?: SolutionOutput
  interview?: InterviewTranscript
  grade?: GradeOutput
  /** additive: design Picture output (AI "diagram"; design contract §7) */
  diagram?: DiagramJson
}

/** v2 part 3 (briefs spec §1): what to do, where to go, what you'll learn and what "done" looks like. */
export interface Brief extends BriefOutput {
  status: 'draft' | 'approved'
  source: 'ai' | 'edited'
  linkCheck?: { url: string; ok: boolean; status: number }[]
}
export type { DayType, DeliverableKind }
/** C-RUNNER §4: the learner's code for a ticket with a problem pack, in table `code` (keyed by ticketId). */
export interface CodeRow {
  ticketId: string
  lang: 'go' | 'py'
  source: string
  updatedAt: number
  /** C-PYTHON §4: true on the ticket's most recently written row (the language the panel reopens on). */
  lastLang?: boolean
}

/** Briefs contract Addendum 1 Q6: one try at a card's learning check, in table `checkAttempts`. */
export interface CheckAttemptRow {
  id: string
  ticketId: string
  at: number
  answers: { id: string; answer?: string; choice?: number }[]
  feedback: CheckResult[]
  passed: boolean
}
/** Spec §3 / Addendum 1 Q11-Q12: a review of one sprint, in table `reviews`; the numbers are computed in code. */
export interface ReviewRow {
  id: string
  sprint: number
  at: number
  stats: ReviewStats
  prose: string
  /** "Do better next sprint" items from the review_sprint job; absent or empty means no list (ruling 8 S4). */
  doBetter?: string[]
  provider: ProviderName
  /** 'auto': built when the sprint ended (prose is empty when the job failed); 'manual': Build review (Addendum 3) */
  kind: ReviewKind
}
export type ReviewKind = 'manual' | 'auto'
/** Spec §2: what a build card handed in (text, code as text, a link or a path), and optional feedback. */
export interface Deliverable { kind: DeliverableKind; text: string; at: number; feedback?: string[] }

export interface Ticket {
  id: string
  origin: TicketOrigin
  track: Track
  kind: Kind
  title: string
  text?: string
  links: Link[]
  skill?: string
  pattern?: string
  difficulty?: Difficulty
  /** additive: Codeforces rating (DATA allows difficulty to be a number; kept separate so E/M/H stays exhaustive) */
  rating?: number
  /** additive: deepest help rung ever reached (DATA "tickets") */
  deepestRung?: 0 | Rung
  /** additive: designs 0–20, AI tasks 0–5 (DATA "tickets") */
  rubricScore?: number
  /** additive: TRACKING §3, from approaches.json or classify */
  approaches?: Approach[]
  /** additive: stored model outputs (AI.md "UI contract") */
  ai?: TicketAi
  /** additive: forge stage number, kind:'stage' tickets only */
  stage?: number
  /** additive: forge weekly rotation slot, kind:'stage' tickets only */
  session?: StageSession
  estMin: number
  plannedSprint: number
  sprint: number
  status: Status
  /** the learner's one-line reason (at most 140 characters, trimmed) for a `blocked` or `help` ticket; removed when the ticket becomes todo, doing or done */
  blockedNote?: string
  slidFrom: number[]
  doneAt?: number
  /** reserved (import removed from core); never true in core */
  doneAtApprox?: boolean
  xp: number
  archived?: boolean
  /** additive (briefs): the card brief, its learning-check attempts and the deliverable handed in */
  brief?: Brief
  deliverable?: Deliverable
  /** additive: plan file order, for stable sorting */
  order: number
  /** additive (flat migration): set on a split session folded into the container with this id; the row is archived history */
  mergedInto?: string
  /** R1 plan content (additive; absent on old documents) */
  lane?: Lane
  node?: string
  area?: string
  phase?: number
  explain?: string[]
  /** D10: reference answers, parallel to `explain` */
  explainAnswers?: string[]
  lab?: LabRef
  asOf?: string
  /** R1 learner-owned (D11): never part of CONTENT_KEYS, so a plan refresh does not overwrite them */
  orderOverride?: number
  learnerNotes?: string
  explainResponses?: string[]
  selfMark?: 'done' | 'partial' | 'skipped'
  /** ms epoch of the learner's last edit of the three fields above */
  learnerUpdatedAt?: number
  proof?: {
    repo?: string
    commit?: string
    note?: string
    built?: ProofSlot
    proven?: ProofSlot
    understood?: ProofSlot
  }
}

/** `studied` = a study session ended without solving anything (ux spec): xpDelta 0, ticket untouched. */
export type Outcome = 'solved' | 'solved_help' | 'gave_up' | 'studied'

export interface Session {
  id: string
  ticketId: string
  start: number
  end: number
  minutes: number
  outcome: Outcome
  xpDelta: number
  notes?: string
  /** additive: help rungs opened in this session, in order (DATA "sessions") */
  rungs?: Rung[]
  /** additive: set when this was a redo session (DATA "Redo schedule") */
  redoId?: string
  /** additive: TRACKING §3 "Which approach did you use?" (approach name or 'other'); not indexed */
  approach?: string
  /** additive: design interview close, "did you understand the reference?"; not indexed, no Dexie bump */
  understood?: boolean
  /** additive (ux spec, study session): "This session I will..." line from the plan step */
  goal?: string
  /** additive: the cards picked in the plan step (the session's own ticket first) */
  cards?: string[]
  /** additive: focus minutes finished in this session (a health signal, never XP) */
  focusMinutes?: number
  /** additive: the end log, three optional texts of at most 280 characters; empty ones are '' */
  endLog?: EndLog
}

/** R1 W6: the two question areas of a bank, the four question types, the four self-grades (trees-and-banks.md BANK-02, BANK-11). */
export type BankArea = 'design' | 'ai'
export type QuestionType = 'concept' | 'estimate' | 'tradeoff' | 'design'
export type BankGrade = 'again' | 'hard' | 'good' | 'easy'
/** A question as the plan ships it (`qbank[]`, BANK-02) and as an AI-made `bankExtra` row stores it (plus `aiMade` and `at`, no `source`). */
export interface PlanQuestion {
  id: string; area: BankArea; node: string; type: QuestionType; difficulty: number
  question: string; answer: string; checklist: string[]; source?: string
}
/** R1 W6: one row per graded question, keyed by the question's id; holds the last grade (BANK-11, BANK-12). */
export interface BankGradeRow { id: string; area: BankArea; node: string; grade: BankGrade; at: number; tries: number }
/** R1 W6: an AI-made question ("More questions", BANK-19). Written only by that job, removed only by Delete (BANK-24). */
export interface BankExtraRow extends Omit<PlanQuestion, 'source'> { aiMade: true; at: number }

/** R1 F1: the daily AI pulse log, one row per local day. Not a ticket: no XP, no streak, no skip. */
export interface Pulse {
  /** `pulse-YYYY-MM-DD` of the local day */
  id: string
  day: string
  /** ms epoch of the last save of that day's line (an edit moves it) */
  at: number
  /** what the learner asked an AI tool, at most 140 characters */
  text: string
}

/** R1 W2: how hard a finished ticket felt, in the learner's words; null when left unanswered. */
export type JournalRating = 'again' | 'hard' | 'good' | 'easy'
/** R1 W2: whether the learner could explain a finished ticket without notes; null when left unanswered. */
export type JournalExplain = 'no' | 'partly' | 'yes'
export type JournalObstacle = 'time' | 'energy' | 'job' | 'tools' | 'other'
export interface JournalItem { ticketId: string; rating: JournalRating | null; explain: JournalExplain | null }
/**
 * R1 W2: the daily journal, one row per local day (`journal-YYYY-MM-DD`). Written only by Save on /journal, never on page load.
 * No XP, no streak. `mode` none is the "No study today" path: no items, an obstacle, an optional one line.
 */
export interface JournalRow {
  id: string
  day: string
  /** ms epoch of the last save (not the entry's day) */
  at: number
  mode: 'studied' | 'none'
  items: JournalItem[]
  hardest?: string
  next?: string
  notes?: string
  obstacle?: JournalObstacle
  line?: string
  /** R2 (floor session): the day's row was written by the 15-minute Floor session */
  floor?: boolean
}

export interface EndLog { done: string; stuckOn: string; nextStep: string }

/** The `replan` event's report (contracts/migration.md MIG-03). Field names are part of the contract. */
export interface ReplanReport {
  /** the manual backup taken just before the migration (`dojo-YYYY-MM-DD-HHMMSS.db`), null when the app runs without a disk server */
  backupFile: string | null
  /** tickets the migration archived (dropped plan tickets and folded split sessions) */
  archived: number
  /** ids of done tickets that are no longer in the plan */
  doneAndDropped: string[]
  xpBefore: number
  xpAfter: number
  designSessionsRewritten: number
  coreMinutesBefore: number
  coreMinutesAfter: number
  /** code rows folded into another one (same container and language); the `code` count drops by this (MIG-08) */
  codeMerged: number
}

export type DojoEvent =
  | { t: 'tick'; id: string; at: number; xp: number }
  | { t: 'untick'; id: string; at: number }
  /** legacy (Undo is retired, nothing writes it): the sync layer still maps `of` to a disk id (src/data/sync/diskIds.ts) */
  | { t: 'undo'; at: number; of: number }
  /** DATA "events": a help rung opened; `applied` = the part the 0 floor actually took */
  | { t: 'rung'; id: string; at: number; rung: HelpRung; cost: number; applied?: number }
  | { t: 'redo_pass'; id: string; at: number; stage: RedoStage; refund: number }
  | { t: 'redo_fail'; id: string; at: number; stage: RedoStage; refund: 0 }
  | { t: 'grade'; id: string; at: number; score: number; max: number }
  /** briefs: a learning-check attempt */
  | { t: 'check'; id: string; at: number; passed: boolean }
  /** ux spec: a finished Pomodoro focus block on a ticket. A health signal only: it never carries XP. */
  | { t: 'focus'; id: string; at: number; minutes: number; sid?: string; block?: number }

  /** flat migration (MIG-03): ran once; total XP is unchanged */
  | { t: 'replan'; at: number; report: ReplanReport }

/** Old stored rows may carry types this build no longer writes (`column`, `slide_sprint`, `shift_plan`); `remapEvent` rewrites their ticket ids generically and an `appSession` stamp; they are only remapped, never read. */
export type StoredEvent = DojoEvent & { seq?: number }

export interface Settings {
  /** 'YYYY-MM-DD' local date Sprint 1 begins; '' until first-launch onboarding sets it */
  startDate: string
  planVersion: string
  /** job id -> ordered provider fallback list; design-only seam, read nowhere in core */
  aiProviders: Record<string, string[]>
  /** additive: cached sum of base XP over non-archived plan tickets */
  possibleXp: number
  /** additive (workload): "Core minutes per sprint"; absent means twice the weekly lane budget (960, 16 h, by default) */
  coreMinutes?: number
  /** additive (workload): the sprint tracking began in; sprints before it never roll over (their cards stay left behind) */
  trackedFrom?: number
  /** R1 (all optional for old documents) */
  modelVersion?: 1 | 2
  flatMigratedAt?: number
  /** minutes per weekday, length 7, Sunday first (Date.getDay order) */
  laneBudgets?: number[]
  careerLane?: boolean
  sessionMinutes?: number
  /** R2: where lab folders are created, as typed (`~/labs` when absent); the server judges it when a lab is set up */
  labsRoot?: string
  navLabels?: 'intro' | 'always' | 'hover'
  /** The highest Pom form ever reached (0 to 8). Written only by an XP-granting action that lifts the computed form above it; the shown form never falls below it. */
  pomFormMax?: number
}

export interface PlanLink { label: string; url: string }
export interface PlanProblem { num: number; name: string; url: string; difficulty: Difficulty; premium?: boolean; order?: number; /** skill-tree node id (TREE-03) */ node?: string }
export interface PlanDsaSprint { sprint: number; topic: string; pattern: string; note: string; problems: PlanProblem[] }
export interface PlanDesign { id: string; title: string; difficulty: Difficulty; deep_dives: string[]; refs: PlanLink[]; order?: number; /** skill-tree node id (TREE-03) */ node?: string }
export interface PlanDesignTier { tier: string; skill: string; items: PlanDesign[] }
/**
 * What the kept screens read from the loaded plan: the two banks, the id map, the version and the learner's own links.
 * A PlanV2 satisfies it as it is; `loadPlan` hands the screens this slim view of the v2 plan.
 */
export interface PlanJson {
  planVersion?: string
  idMap?: Record<string, string>
  dsa_bank: PlanDsaSprint[]
  design_bank: PlanDesignTier[]
  /** G6, optional: the learner's own links. A plan link whose url is `{{learner.<key>}}` resolves here, or is dropped. */
  learner?: PlanLearner
}

/** G6: the learner's own links (settings, not shipped values). */
export interface PlanLearner {
  /** Their own coding-patterns notes or repo (DSA learn links). */
  patternsRepo?: string
}

// ---------- schema v2 rows (spec §2.2) ----------

/** H: one row per help rung opened in an attempt cycle (PLATFORM "Do"; DATA "XP"). */
export interface RungUse {
  id: string
  ticketId: string
  /** informational: wall-clock start of the attempt cycle this rung was recorded under */
  attemptStart: number
  /** the attempt cycle (Cycle.id) this rung belongs to - the actual identity key (not
   * attemptStart: two distinct cycles can share a wall-clock attemptStart, e.g. under a frozen
   * or adjusted clock). Not part of the Dexie index - rows are always loaded by ticketId first,
   * then filtered by cycleId in memory, so no schema bump is needed for it. */
  cycleId: string
  rung: HelpRung
  at: number
  cost: number
  /** part of `cost` actually taken from net XP (floor 0) */
  applied: number
  refunded: number
  /** hint level 1 | 2 */
  level?: 1 | 2
  /** TRACKING §3: the approach a Picture was opened for */
  approach?: string
  source?: 'library' | 'model'
  redoId?: string
}

export type RedoSource = 'gave_up' | 'solved_help' | 'design_rubric' | 'design_missed' | 'journal_hard' | 'blank_test' | 'stage_built' | 'check_failed' | 'bank_q' | 'explain' | 'lab_review'
/** R1 W2: what a `journal_hard` redo reviews, copied from its ticket's first explain question when the learner pressed Add to Review. */
export interface JournalPiece { topic: string; question: string; answer: string }
/** F3: what a `design_missed` redo reviews, copied from the AI grade's `missed` entry when the learner pressed Add. */
export interface MissedPiece { topic: string; question: string; answer: string; sessionId: string }
/** R1 W6: what a `bank_q` redo reviews (BANK-14): the node title, the question and its model answer, and the question id (also the redo's `ticketId`). */
export interface BankPiece { topic: string; question: string; answer: string; qid: string }
/** H (D, P enqueue): the spaced-redo queue (DATA "Redo schedule"; TRACKING §1–2). */
export interface Redo {
  id: string
  ticketId: string
  source: RedoSource
  createdAt: number
  stage: RedoStage
  /** ms, or a local 'YYYY-MM-DD' for a redo a failed learning check scheduled (Addendum 1 Q6); read it with dueMs() */
  due: number | string
  passed: boolean[]
  /** C in the ladder contract: help cost of the session that created or last reset this redo */
  helpCost: number
  refunded: number
  closedAt?: number
  /** a legacy blank-test or stage redo: what is being rebuilt (a string); a `design_missed` redo: the weak spot to review (MissedPiece); a `journal_hard` redo on a ticket with an explain question: JournalPiece; a `bank_q` redo: BankPiece */
  piece?: string | MissedPiece | JournalPiece | BankPiece
}

/** H: one row per AI job call (AI.md "Provider": log job and ms). */
export interface AiLogRow {
  seq?: number
  job: JobName
  at: number
  ms: number
  provider: ProviderName
  ok: boolean
  code?: AiErrorCode
  ticketId?: string
  error?: string
}

/** L, H: DATA "pictures (cache)". key = ticketId or pattern. */
export interface PictureRow { key: string; json: SrAlgoJson; source: 'library' | 'model'; createdAt: number }

/**
 * L: one Atlas event (VISUALIZER "Predict mode", "The Atlas tab"): a walkthrough seen, or a predict
 * run with asked/correct counts (≥ 80% correct = predicted). key = pattern label or library key.
 */
export interface AtlasRun { seq?: number; key: string; kind: 'seen' | 'predict'; at: number; asked?: number; correct?: number }

export type DesignPhase = 'setup' | 'drawing' | 'close' | 'score' | 'done'
export interface Tradeoff { chose: string; over: string; because: string }
/** TRACKING §1: 0 blank · 1 hand-wave · 2 trade-off with a number or failure mode; null = not scored yet. */
export interface DeepDive { q: string; answered: Score012 | null; answer?: string; by?: 'self' | 'model' | 'partner' }
/** Partner sheet: five rubric rows scored 0 to 4 (null = not scored) and four deep dives scored 0 to 2. */
export interface PartnerScores { perItem: (number | null)[]; deepDives: (Score012 | null)[] }
/** `notes`: the friend's free text about the session (at most 2000 characters, plain text, may be empty); the host reads it, never edits it. */
export interface PartnerState { name?: string; at?: number; scores?: PartnerScores; notes?: string }
/** TRACKING §1 "The 5-question close" (texts in content/tracking.ts CLOSE_QUESTIONS). */
export interface CloseAnswers {
  /** Q1, becomes tradeoffs[0] */
  tradeoff: Tradeoff
  /** Q2 */
  breaksAt10x: string
  /** Q3 */
  dataOwnership: string
  /** Q4: index of the deep dive he could not answer without notes, 'none', or null = unanswered */
  couldNotAnswer: 0 | 1 | 2 | 3 | 'none' | null
  /** Q5 */
  readNext: string
}
/** D: one Sunday design session (TRACKING §1 DesignSession; design contract §4). */
export interface DesignSession {
  id: string
  designId: string
  /** start time */
  at: number
  phase: DesignPhase
  endedAt?: number
  /** when the canvas locked (45:00 or End drawing) */
  lockedAt?: number
  /** F2: set while the 45-minute clock is paused (when it was paused); removed on Resume and at the lock */
  pausedAt?: number
  /** F2: the sum of the pauses that ended, in ms; the lock folds an open pause into it. Drawing time = lockedAt - at - pausedMs */
  pausedMs?: number
  /** drawing minutes, pauses left out */
  minutes: number
  mode: DesignMode | 'interviewer'
  view: '2d' | 'iso'
  /** his sr-diagram canvas (layout 'manual') */
  canvas: DiagramJson
  close: CloseAnswers
  deepDives: DeepDive[]
  tradeoffs: Tradeoff[]
  /** 0–20 */
  rubric: number | null
  rubricBy?: 'self' | 'model' | 'partner'
  lenses: Partial<Record<Lens, Score012>>
  /** job `diagram` reference, shown beside his */
  reference?: DiagramJson
  interview?: InterviewTranscript
  notes?: DesignNotes
  partner?: PartnerState
  redesignDue?: number
  /** the earlier session this one redesigns (redesign pass rate) */
  redesignOf?: string
  /** F3: when "Keep what you missed" added this session's weak spots as review cards (ms); absent until then */
  keptAt?: number
}

/** TRACKING §2, verbatim strings (spaces included). Board order in content/tracking.ts ARTIFACT_STATUSES. */
export type ArtifactStatus = 'not started' | 'building' | 'runs' | 'measured' | 'written up'

/** P (D): every grade result, history kept (AI.md "grade"). */
export interface GradeRow {
  id: string
  targetKind: 'ticket' | 'artifact'
  targetId: string
  at: number
  score: number
  max: number
  passed: boolean
  feedback: string[]
  missing: string[]
  commitFound?: boolean
  provider: ProviderName
}

export type BankStatus = 'todo' | 'doing' | 'done'
/** B: one problem in one bank (PLATFORM "Banks"). id = `${bank}:${key}`. Mine rows also carry the pasted input and classify result. */
export interface BankItem {
  id: string
  bank: BankId
  key: string
  name: string
  url?: string
  num?: number
  pattern: AtlasPattern | null
  difficulty?: Difficulty
  rating?: number
  status: BankStatus
  /** the one ticket this problem maps to ("one problem, one ticket, many banks") */
  ticketId?: string
  inPlan?: boolean
  addedAt: number
  input?: string
  inputKind?: 'url' | 'text'
  /** 'LeetCode' | 'Codeforces' | 'Text' (banks contract §5.5) */
  source?: string
  classify?: ClassifyOutput
  classifiedAt?: number
}

// ---- R2: labs (table keys in src/data/db.ts SCHEMA_V11; shapes are spec 4.1, 4.2 and 4.5/4.6 and contracts/README.md "Data fields") ----

/** A hint the learner opened: one entry per (ticket, rung) at most. */
export interface LabHintUse { ticketId: string; rung: 1 | 2 | 3; at: number }
/** `labs`, key `labId`: one row per set-up lab. `root` is the labs folder as Settings held it at set up (`~/labs`, unexpanded). */
export interface LabRow {
  labId: string
  repo: string
  /** the lab's folder inside the repo, e.g. `labs/t-lab` */
  path: string
  root: string
  baseCommit: string
  version: number
  setupAt: number
  hints: LabHintUse[]
}
export type LabCheckStatus = 'pass' | 'fail' | 'skip'
export interface LabCheckResult { id: string; name: string; status: LabCheckStatus; detail: string; metrics?: Record<string, unknown> }
export interface LabResults { checks: LabCheckResult[]; summary: { pass: number; fail: number; skip: number } }
/** `labRuns`, key `id` (`run-<labId>-<ms>`): one row per Run checks that ran. */
export interface LabRunRow {
  id: string
  labId: string
  at: number
  ms: number
  /** make's exit status, null when it was killed */
  exit: number | null
  timedOut: boolean
  results: LabResults | null
  error?: 'no_results' | 'bad_results'
  /** the last 4000 characters of the combined output */
  tail: string
}
export interface LabEvidence { quote: string; file: string; line: number }
export interface LabReviewItem { id: string; score: 0 | 1 | 2 | 3; evidence: LabEvidence[]; stronger: string }
/** `labReviews`, key `id` (`rev-<labId>-<ms>`): one row per review that came back valid. The newest by `at` counts. */
export interface LabReviewRow {
  id: string
  labId: string
  at: number
  items: LabReviewItem[]
  /** computed by the app: floor(sum of scores * 100 / (3 * items)) */
  percent: number
  passed: boolean
  summary: string
}
/** `weeklyReviews`, key `id` (`wr-<ISO week>`): the Sunday review (W5). */
export interface WeeklyReviewRow { id: string; week: string; worked: string; change: string; focus: string; at: number }
/** `portfolioItems`, key `id` (`<labId>:<kind>`): one output of a Proven lab (W6). */
export interface PortfolioItem {
  id: string
  labId: string
  kind: 'repo' | 'site' | 'article' | 'linkedin'
  status: 'draft' | 'published'
  draft: string
  updatedAt: number
  publishedAt?: number
  url?: string
}

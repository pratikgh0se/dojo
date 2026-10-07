import type {
  AiErrorCode, Approach, BriefOutput, BriefSplitPart, CheckResult, DayType, DeliverableKind, ReviewStats, ClassifyOutput, DiagramJson, GradeOutput, InterviewFinal, JobName, Lens, ProviderName,
  Score012, SolutionOutput, SrAlgoJson,
} from '../ai/types'
import type { AtlasPattern } from '../content/patterns'
import type { Weekday } from '../lib/dates'

export type { Approach, AtlasPattern, Lens, Score012 }

export type Track = 'ai' | 'interview'
/** 'watch' and 'read' are learning cards (briefs contract Addendum 1 Q1): the plan itself only has the first four. */
export type Kind = 'task' | 'problem' | 'design' | 'stage' | 'watch' | 'read'
export type Status = 'todo' | 'doing' | 'done' | 'slid'
export type Difficulty = 'E' | 'M' | 'H'
/** Weekly rotation slot a stage ticket (kind:'stage') belongs to; forge AI-track rewrite only. */
export type StageSession = 'watch' | 'rebuild' | 'build' | 'teachback'
export interface ProofSlot { at: number; evidence: string }
export interface Link { label: string; url: string }

/** DATA "tickets" origin; PLATFORM "Banks". */
export type BankId = 'neetcode150' | 'blind75' | 'striver' | 'codeforces' | 'hellointerview' | 'mine'
export type TicketOrigin =
  | 'plan' | 'bank:neetcode150' | 'bank:blind75' | 'bank:striver' | 'bank:codeforces' | 'bank:hellointerview' | 'mine'
  /** briefs BR-08: a session split off a big item has its parent's id as its origin (and `childOf` set) */
  | (string & {})
/** PLATFORM "Do" ladder: 1 Attempt · 2 Hint · 3 Picture · 4 Video · 5 Solution. */
export type Rung = 1 | 2 | 3 | 4 | 5
export type HelpRung = 2 | 3 | 4 | 5
/** DATA "Redo schedule": stage 0 = +3d, 1 = +10d, 2 = +30d. */
export type RedoStage = 0 | 1 | 2
export interface InterviewMessage { from: 'interviewer' | 'you'; text: string }
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
export interface Brief extends Omit<BriefOutput, 'split'> {
  status: 'draft' | 'approved'
  source: 'ai' | 'edited'
  linkCheck?: { url: string; ok: boolean; status: number }[]
  /** the model's proposal to split a big item (kept so the Split dialog can prefill it) */
  splitSuggestion?: BriefSplitPart[]
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
  slidFrom: number[]
  doneAt?: number
  /** reserved (import removed from core); never true in core */
  doneAtApprox?: boolean
  xp: number
  archived?: boolean
  /** additive (briefs): the card brief, its learning-check attempts and the deliverable handed in */
  brief?: Brief
  deliverable?: Deliverable
  /** additive (workload): rebalancing leaves a pinned card alone */
  pinned?: boolean
  /** additive (workload): the sprints this card rolled over from, oldest first */
  rolledFrom?: number[]
  /** additive (workload): where a rolled-over card counts in the Today/Load views (its home sprint) while it sits in `into` */
  carry?: { home: number; into: number }
  /** additive (split): a container's child ids; the container is done when all children are */
  children?: string[]
  /** additive (split): the container this session was split from */
  childOf?: string
  /** additive (split, ruling 10 Q22): when a container's own check passed; it is done once this is set and every child is */
  checkPassedAt?: number
  /** additive (split): this session's share of the parent's base XP, so splitting never mints XP */
  xpBase?: number
  /** additive: plan file order, for stable sorting */
  order: number
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

export interface EndLog { done: string; stuckOn: string; nextStep: string }

export type DojoEvent =
  | { t: 'tick'; id: string; at: number; xp: number }
  | { t: 'untick'; id: string; at: number }
  | { t: 'slide'; id: string; at: number; from: number; to: number; reason: 'manual' | 'sprint' | 'plan' }
  | { t: 'slide_sprint'; at: number; sprint: number; count: number; to: number; ids: string[] }
  | { t: 'shift_plan'; at: number; fromSprint: number; ids: string[]; to: Record<string, number> }
  | { t: 'undo'; at: number; of: number }
  /** DATA "events": a help rung opened; `applied` = the part the 0 floor actually took */
  | { t: 'rung'; id: string; at: number; rung: HelpRung; cost: number; applied?: number }
  | { t: 'redo_pass'; id: string; at: number; stage: RedoStage; refund: number }
  | { t: 'redo_fail'; id: string; at: number; stage: RedoStage; refund: 0 }
  | { t: 'grade'; id: string; at: number; score: number; max: number }
  /** briefs: one roll-over run: these cards moved on to sprint `to` from the sprints that ended (no XP) */
  | { t: 'rolled'; at: number; to: number; ids: string[] }
  /** briefs: a learning-check attempt */
  | { t: 'check'; id: string; at: number; passed: boolean }
  /** workload: the user moved a card to another sprint by hand or accepted a rebalance move */
  | { t: 'moved'; id: string; at: number; from: number; to: number; why: 'manual' | 'rebalance' }
  /** UAT r3 J7: a card moved between Board columns (drag, Shift+arrow, d); Undo moves it back */
  | { t: 'column'; id: string; at: number; from: Status; to: Status }
  /** ux spec: a finished Pomodoro focus block on a ticket. A health signal only: it never carries XP. */
  | { t: 'focus'; id: string; at: number; minutes: number; sid?: string; block?: number }

  /** ruling 20 S6: a card was split into sessions (`parts`); Undo removes the parts while none has been started */
  | { t: 'split'; id: string; at: number; parts: string[] }

/** `appSession`: the app session that wrote an undoable event (ruling 20 S6: Undo is per session). */
export type StoredEvent = DojoEvent & { seq?: number; appSession?: string }

export interface Settings {
  /** 'YYYY-MM-DD' local date Sprint 1 begins; '' until first-launch onboarding sets it */
  startDate: string
  planVersion: string
  /** job id -> ordered provider fallback list; design-only seam, read nowhere in core */
  aiProviders: Record<string, string[]>
  /** additive: cached sum of base XP over non-archived plan tickets */
  possibleXp: number
  /** additive (workload): "Core minutes per sprint"; absent means 1440 (24 h) */
  coreMinutes?: number
  /** additive (workload): the sprint tracking began in; sprints before it never roll over (their cards stay left behind) */
  trackedFrom?: number
}

export interface PlanLink { label: string; url: string }
export interface PlanTask {
  id: string; skill: string; text: string; links: PlanLink[]; kind?: 'task' | 'stage' | 'watch' | 'read'
  /** additive: forge AI-track rewrite fields, present only when kind is 'stage' */
  stage?: number; session?: StageSession
}
export interface PlanSprint {
  sprint: number
  block: number
  block_title: string
  block_theme: string
  focus_ai: string
  focus_interview: string
  ai: PlanTask[]
  interview: PlanTask[]
  proof: string | null
}
export interface PlanProblem { num: number; name: string; url: string; difficulty: Difficulty; premium?: boolean }
export interface PlanDsaSprint { sprint: number; topic: string; pattern: string; note: string; problems: PlanProblem[] }
export interface PlanDesign { id: string; title: string; difficulty: Difficulty; deep_dives: string[]; refs: PlanLink[] }
export interface PlanDesignTier { tier: string; skill: string; items: PlanDesign[] }
export interface PlanPhase { n: string; months: number[]; note: string }
export interface PlanSkill { id: string; label: string; tier: number; needs: string[]; what: string; why: string }
export type CommunityLane = 'learner' | 'contributor' | 'program'
export interface PlanCommunity { n: string; k: string; u: string; fit: string; how: string; lane: CommunityLane }
export interface PlanShelfItem { skill: string; text: string; links: PlanLink[]; from?: string }
export interface PlanJson {
  generated?: string
  planVersion?: string
  idMap?: Record<string, string>
  sprint_days: number
  total_sprints: number
  rotation: Partial<Record<Weekday, string>>
  sprints: PlanSprint[]
  dsa_bank: PlanDsaSprint[]
  design_bank: PlanDesignTier[]
  /** additive, optional (M5 content tabs); views render an empty state when absent */
  phases?: PlanPhase[]
  skills?: PlanSkill[]
  communities?: PlanCommunity[]
  ai_shelf?: PlanShelfItem[]
  /** G6, optional: the learner's day (Ritual tab, Today's time line). Absent: the neutral defaults in content/schedule.ts. */
  schedule?: Partial<PlanSchedule>
  /** G6, optional: the learner's own links. A plan link whose url is `{{learner.<key>}}` resolves here, or is dropped. */
  learner?: PlanLearner
}

/**
 * G6: the learner's daily schedule as plan data, so the shipped sample carries a neutral day and a learner's own
 * values come from DOJO_HOME/profile.json (server/profile.mjs lays its `plan.schedule` over plan.json).
 */
export interface PlanSchedule {
  /** The Ritual tab's opening paragraph. */
  intro: string
  /** The weekday study block, 24 h "HH:MM": Today shows "start – end" on block days, the Ritual timeline "start to end". */
  block: { start: string; end: string }
  /** "A weekday, concretely": rows in order; the row with `block: true` is the study block (its time comes from `block`). */
  timeline: Array<{ time?: string; what: string; block?: boolean }>
  /** The note under the weekday timeline. */
  timelineNote: string
  /** Today's sentence on the rest day. */
  restDay: string
  /** Where links captured during the week go (Ritual · Saturday news slot), e.g. "a note on your phone". */
  inbox: string
  /** What compressing the plan would cost (Overview · Why three years): "Compressing it means skipping <protects>". */
  protects: string
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

export type RedoSource = 'gave_up' | 'solved_help' | 'design_rubric' | 'blank_test' | 'stage_built' | 'check_failed'
/** H (D, P enqueue): the spaced-redo queue (DATA "Redo schedule"; TRACKING §1–2; CAPSTONE "Proof model"). */
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
  /** blank tests / capstone pieces: what is being rebuilt */
  piece?: string
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
export interface DeepDive { q: string; answered: Score012 | null; answer?: string; by?: 'self' | 'model' }
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
  minutes: number
  mode: 'solo' | 'interviewer'
  view: '2d' | 'iso'
  /** his sr-diagram canvas (layout 'manual') */
  canvas: DiagramJson
  close: CloseAnswers
  deepDives: DeepDive[]
  tradeoffs: Tradeoff[]
  /** 0–20 */
  rubric: number | null
  rubricBy?: 'self' | 'model'
  lenses: Partial<Record<Lens, Score012>>
  /** job `diagram` reference, shown beside his */
  reference?: DiagramJson
  interview?: InterviewTranscript
  redesignDue?: number
  /** the earlier session this one redesigns (redesign pass rate) */
  redesignOf?: string
}

/** TRACKING §2, verbatim strings (spaces included). Board order in content/tracking.ts ARTIFACT_STATUSES. */
export type ArtifactStatus = 'not started' | 'building' | 'runs' | 'measured' | 'written up'
export interface Measure { name: string; value: number; unit: string; at: number; sprint: number }
/** P: TRACKING §2 Artifact + projects contract §2.6 stored grade fields. */
export interface Artifact {
  id: string
  title: string
  block: number
  /** capstone stage 0–11 */
  stage?: number
  repo?: string
  commit?: string
  note?: string
  status: ArtifactStatus
  /** first time each status was reached (artifact timeline burn-up) */
  statusAt: Partial<Record<ArtifactStatus, number>>
  measures: Measure[]
  /** vault link */
  writeup?: string
  userAdded?: boolean
  grade?: number
  gradedAt?: number
  gradeFeedback?: string[]
  gradeMissing?: string[]
  commitFound?: boolean
}

export type StageCellKind = 'learn' | 'build' | 'prove'
/** P: learn → build → prove cube per capstone stage (TRACKING §2 cells re-keyed by stage, spec F3). id = `${stage}:${cell}`. */
export interface StageCell {
  id: string
  stage: number
  cell: StageCellKind
  at: number
  evidence: string
  via: 'tick' | 'commit' | 'tests' | 'grade' | 'blank_test' | 'redo'
}

/** P: TRACKING §2 "The blank-editor test". */
export interface BlankTest { id: string; stage: number; piece: string; at: number; minutes: number; outcome: 'solved' | 'not_yet'; redoId?: string }

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

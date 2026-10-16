import { INTERVIEW_RUBRIC } from '../ai/rubric'
import { coachTurn, COACH_TURNS, PHASE_LABEL, turnTopic, type CoachPhase, type CoachTopic } from '../ai/coachPlan'
import { LENSES, type InterviewFinal, type Lens, type Score012 } from '../ai/types'
import type { CloseAnswers, DeepDive, DesignSession, Tradeoff } from '../data/types'
import { addLocalDays, localDayKey, pad2, startOfLocalDay } from '../lib/dates'
import { modeLabel, readDesignMode } from './designMode'

export const SESSION_MINUTES = 45
export const SESSION_MS = SESSION_MINUTES * 60_000
export const RUBRIC_MAX = 20
export const REDESIGN_DAYS = 30
export const REDESIGN_RUBRIC_BELOW = 14
export const MIN_TRADEOFFS = 2
export const DIVE_COUNT = 4

export const DIVE_WORDS: Record<Score012, string> = { 0: 'blank', 1: 'hand-wave', 2: 'trade-off with a number or failure mode' }
export const LENS_LABELS: Record<Lens, string> = {
  load: 'Load', data: 'Data', consistency: 'Consistency', failure: 'Failure', latency: 'Latency', cost: 'Cost', evolution: 'Evolution',
}
export const RUBRIC_BREAKDOWN =
  'Requirements and numbers (4) · API and data model (3) · High-level design that meets the numbers (4) · Two deep dives with real trade-offs (6) · Failure modes and operations (3)'
export const NONE_OPTION = 'None, I answered all four'
export const EMPTY_TRADEOFF: Tradeoff = { chose: '', over: '', because: '' }
export const EMPTY_CLOSE: CloseAnswers = {
  tradeoff: { ...EMPTY_TRADEOFF }, breaksAt10x: '', dataOwnership: '', couldNotAnswer: null, readNext: '',
}

/** `pausedAt` is set while the clock is stopped; `pausedMs` is the sum of the pauses that ended (a lock folds an open pause into it). */
type Clocked = { at: number; lockedAt?: number; pausedAt?: number; pausedMs?: number }

/** Drawing time so far: wall time since the start, minus every pause. Frozen at the lock, and while paused frozen at the pause. */
function activeMs(s: Clocked, nowMs: number): number {
  const end = s.lockedAt ?? (s.pausedAt != null ? Math.min(nowMs, s.pausedAt) : nowMs)
  return Math.max(0, end - s.at - (s.pausedMs ?? 0))
}

/** Time left on the 45-minute box, frozen at the lock and while paused. Never more than the box: a clock reading taken before the session began (a rail
 * that ticked once before Start, DESIGN-06) counts as zero elapsed, so the countdown starts at 45:00, never 45:01. */
export function remainingMs(s: Clocked, nowMs: number): number {
  return Math.max(0, SESSION_MS - activeMs(s, nowMs))
}

/** mm:ss of whole seconds left, rounded up (so 10:00.4 elapsed still reads 35:00). */
export function clockText(ms: number): string {
  const secs = Math.ceil(Math.max(0, ms) / 1000)
  return `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`
}

/** Out of drawing time. Never while paused: auto-lock cannot fire with the clock stopped. */
export function isOverdue(s: Clocked & { phase: DesignSession['phase'] }, nowMs: number): boolean {
  return s.phase === 'drawing' && s.pausedAt == null && activeMs(s, nowMs) >= SESSION_MS
}

/**
 * Lock time and recorded minutes (drawing time, pauses left out); a session found past 45 drawing minutes locks at exactly 45 (DECISION 16).
 * Locking while paused folds the open pause into `pausedMs` and clears `pausedAt` (the lock time is the moment of the lock).
 */
export function lockAt(
  s: Clocked, nowMs: number,
): { lockedAt: number; minutes: number; pausedMs?: number; pausedAt?: undefined } {
  const paused = s.pausedAt != null
  const base = s.pausedMs ?? 0
  const pausedMs = base + (paused ? Math.max(0, nowMs - s.pausedAt!) : 0)
  const lockedAt = paused ? nowMs : Math.min(nowMs, s.at + base + SESSION_MS)
  const minutes = Math.min(SESSION_MINUTES, Math.floor(Math.max(0, lockedAt - s.at - pausedMs) / 60_000))
  return paused ? { lockedAt, minutes, pausedMs, pausedAt: undefined } : { lockedAt, minutes }
}

/** Stop the clock (once: a paused session stays as it is). */
export function applyPause<T extends Clocked>(s: T, nowMs: number): T {
  return s.pausedAt != null ? s : { ...s, pausedAt: nowMs }
}

/** Start the clock again: the pause that just ended joins `pausedMs`. */
export function applyResume<T extends Clocked>(s: T, nowMs: number): T {
  if (s.pausedAt == null) return s
  const { pausedAt, ...rest } = s
  return { ...rest, pausedMs: (s.pausedMs ?? 0) + Math.max(0, nowMs - pausedAt) } as T
}

/** The footer's line on what is graded, by mode. */
export function gradedText(mode: unknown): string {
  const m = readDesignMode(mode)
  return m === 'ai-partner' ? 'Canvas, notes and the chat are all graded.' : m === 'solo' ? 'Canvas and notes are graded.' : 'Your partner scores the canvas and notes.'
}

export type LockReason = 'timer' | 'ended'

export function lockReason(s: Clocked): LockReason | null {
  if (s.lockedAt == null) return null
  return activeMs(s, s.lockedAt) >= SESSION_MS ? 'timer' : 'ended'
}

export const lockStatusText = (r: LockReason): string => (r === 'timer' ? 'Canvas locked at 45 minutes' : 'Canvas locked')

export interface InterviewStage { answers: number; phase: CoachPhase; topic: CoachTopic; activeDive: number; status: string }

/** Where the AI partner's conversation is. The phase comes from the number of answers given, so a reload never moves it. */
export function interviewStage(messages: readonly { from: 'interviewer' | 'you' }[]): InterviewStage {
  const answers = messages.filter(m => m.from === 'you').length
  const t = coachTurn(answers)
  const topic = turnTopic(t)
  let activeDive = 0
  for (let i = 0; i <= Math.min(answers, COACH_TURNS.length - 1); i++) activeDive = COACH_TURNS[i].dive ?? activeDive
  return { answers, phase: t.phase, topic, activeDive, status: topic === 'challenge' ? `${PHASE_LABEL[t.phase]} · discussion` : PHASE_LABEL[t.phase] }
}

export function needsInterviewerTurn(messages: readonly { from: 'interviewer' | 'you' }[]): boolean {
  return messages.length === 0 || messages[messages.length - 1].from === 'you'
}

const filled = (s: string | undefined) => !!s && s.trim().length > 0

export function tradeoffComplete(t: Tradeoff): boolean {
  return filled(t.chose) && filled(t.over) && filled(t.because)
}

export function closeComplete(c: CloseAnswers): boolean {
  return tradeoffComplete(c.tradeoff) && filled(c.breaksAt10x) && filled(c.dataOwnership) && c.couldNotAnswer !== null && filled(c.readNext)
}

export function cappedDive(c: CloseAnswers): number | null {
  return typeof c.couldNotAnswer === 'number' ? c.couldNotAnswer : null
}

export function capScore(score: Score012 | null, i: number, cap: number | null): Score012 | null {
  return cap === i && score === 2 ? 1 : score
}

export function seedTradeoffs(c: CloseAnswers, existing: Tradeoff[]): Tradeoff[] {
  return existing.length > 0 ? existing : [{ ...c.tradeoff }, { ...EMPTY_TRADEOFF }]
}

export type RubricParse = { value: number | null; invalid: boolean }

export function parseRubric(text: string): RubricParse {
  const t = text.trim()
  if (t === '') return { value: null, invalid: false }
  if (!/^\d+$/.test(t)) return { value: null, invalid: true }
  const n = Number(t)
  return n <= RUBRIC_MAX ? { value: n, invalid: false } : { value: null, invalid: true }
}

type Scorable = { deepDives: DeepDive[]; lenses: Partial<Record<Lens, Score012 | undefined>>; tradeoffs: Tradeoff[]; rubric: number | null }

/**
 * Complete needs exactly what the contract names (DESIGN-66, DESIGN-72): every deep dive scored and a whole rubric from 0 to 20.
 * The lens groups and the second trade-off row are still on the form but stay optional: no contract hook reaches them.
 */
export function scoreReady(s: Scorable): boolean {
  return (
    s.deepDives.length === DIVE_COUNT && s.deepDives.every(d => d.answered !== null)
    && s.rubric !== null && Number.isInteger(s.rubric) && s.rubric >= 0 && s.rubric <= RUBRIC_MAX
  )
}

/** The most each of the five grade items can score (the same numbers as the prompt's rubric and RUBRIC_BREAKDOWN). */
export const RUBRIC_ITEM_MAX: readonly number[] = INTERVIEW_RUBRIC.map(r => r.max)

const clampInt = (n: number, max: number): number => Math.min(max, Math.max(0, Math.round(Number.isFinite(n) ? n : 0)))

/** What item `i` (0-based) is worth on the page: a whole number, held to 0..its maximum (a model's 6 of 4 reads 4 of 4). */
export const itemPoints = (i: number, points: number): number => clampInt(points, RUBRIC_ITEM_MAX[i] ?? 0)

/** The grade's total: the five items (each as itemPoints shows it) added up, so the page, the stored rubric and the items always agree (DESIGN-68). Always 0..20. */
export function finalTotal(final: InterviewFinal): number {
  const items = final.perItem.slice(0, 5)
  return clampInt(items.length > 0 ? items.reduce((a, p, i) => a + itemPoints(i, p.points), 0) : final.score, RUBRIC_MAX)
}

export function prefillFromFinal(
  final: InterviewFinal, dives: DeepDive[], cap: number | null,
): { deepDives: DeepDive[]; lenses: Record<Lens, Score012>; rubric: number } {
  return {
    deepDives: dives.map((d, i) => ({ ...d, answered: capScore(final.deepDives[i] ?? null, i, cap), by: 'model' as const })),
    lenses: { ...final.lenses },
    rubric: finalTotal(final),
  }
}

export function needsRedesign(rubric: number, dives: DeepDive[]): boolean {
  return rubric < REDESIGN_RUBRIC_BELOW || dives.some(d => d.answered === 0)
}

export function redesignDueAt(nowMs: number): number {
  return startOfLocalDay(addLocalDays(nowMs, REDESIGN_DAYS))
}

export function summaryText(s: { mode: unknown; minutes: number; rubric: number | null }): string {
  return `${modeLabel(s.mode)} · ${s.minutes} min · rubric ${s.rubric ?? '–'} / ${RUBRIC_MAX}`
}

export function divesText(dives: DeepDive[]): string {
  return dives.map(d => (d.answered === null ? '–' : String(d.answered))).join(' · ')
}

export function lensText(lenses: Partial<Record<Lens, Score012>>): string {
  return LENSES.map(l => `${LENS_LABELS[l]} ${lenses[l] ?? '–'}`).join(' · ')
}

export function pngName(designId: string, atMs: number, suffix?: string): string {
  return `${designId}-${localDayKey(atMs)}${suffix ? `-${suffix}` : ''}.png`
}

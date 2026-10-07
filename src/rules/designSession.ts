import { LENSES, type InterviewFinal, type Lens, type Score012 } from '../ai/types'
import type { CloseAnswers, DeepDive, DesignSession, Tradeoff } from '../data/types'
import { addLocalDays, localDayKey, pad2, startOfLocalDay } from '../lib/dates'

export const SESSION_MINUTES = 45
export const SESSION_MS = SESSION_MINUTES * 60_000
export const RUBRIC_MAX = 20
export const REDESIGN_DAYS = 30
export const REDESIGN_RUBRIC_BELOW = 14
export const MIN_TRADEOFFS = 2
/** 1 requirements answer + 4 deep dives × (answer, push-back answer). */
export const INTERVIEW_ANSWERS = 9
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

type Clocked = { at: number; lockedAt?: number }

/** Time left on the 45-minute box, frozen at the lock. */
export function remainingMs(s: Clocked, nowMs: number): number {
  return Math.max(0, SESSION_MS - ((s.lockedAt ?? nowMs) - s.at))
}

/** mm:ss of whole seconds left, rounded up (so 10:00.4 elapsed still reads 35:00). */
export function clockText(ms: number): string {
  const secs = Math.ceil(Math.max(0, ms) / 1000)
  return `${pad2(Math.floor(secs / 60))}:${pad2(secs % 60)}`
}

export function isOverdue(s: { at: number; phase: DesignSession['phase'] }, nowMs: number): boolean {
  return s.phase === 'drawing' && nowMs - s.at >= SESSION_MS
}

/** Lock time and recorded minutes; a session found past 45 minutes locks at exactly 45 (DECISION 16). */
export function lockAt(s: { at: number }, nowMs: number): { lockedAt: number; minutes: number } {
  const lockedAt = Math.min(nowMs, s.at + SESSION_MS)
  return { lockedAt, minutes: Math.min(SESSION_MINUTES, Math.floor((lockedAt - s.at) / 60_000)) }
}

export type LockReason = 'timer' | 'ended'

export function lockReason(s: Clocked): LockReason | null {
  if (s.lockedAt == null) return null
  return s.lockedAt - s.at >= SESSION_MS ? 'timer' : 'ended'
}

export const lockStatusText = (r: LockReason): string => (r === 'timer' ? 'Canvas locked at 45 minutes' : 'Canvas locked')
export const interviewStoppedText = (r: LockReason): string => (r === 'timer' ? 'Interview stopped at 45 minutes' : 'Interview stopped')

export interface InterviewStage { answers: number; activeDive: number; complete: boolean; status: string }

export function interviewStage(messages: readonly { from: 'interviewer' | 'you' }[]): InterviewStage {
  const answers = messages.filter(m => m.from === 'you').length
  if (answers >= INTERVIEW_ANSWERS) return { answers, activeDive: 0, complete: true, status: 'Interview complete · 4 of 4 deep dives' }
  if (answers === 0) return { answers, activeDive: 0, complete: false, status: 'Requirements' }
  const activeDive = Math.ceil(answers / 2)
  return { answers, activeDive, complete: false, status: `Deep dive ${activeDive} of 4` }
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

export function scoreReady(s: Scorable): boolean {
  return (
    s.deepDives.length === DIVE_COUNT && s.deepDives.every(d => d.answered !== null)
    && LENSES.every(l => s.lenses[l] !== undefined)
    && s.tradeoffs.filter(tradeoffComplete).length >= MIN_TRADEOFFS
    && s.rubric !== null && Number.isInteger(s.rubric) && s.rubric >= 0 && s.rubric <= RUBRIC_MAX
  )
}

export function prefillFromFinal(
  final: InterviewFinal, dives: DeepDive[], cap: number | null,
): { deepDives: DeepDive[]; lenses: Record<Lens, Score012>; rubric: number } {
  return {
    deepDives: dives.map((d, i) => ({ ...d, answered: capScore(final.deepDives[i] ?? null, i, cap), by: 'model' as const })),
    lenses: { ...final.lenses },
    rubric: final.score,
  }
}

export function needsRedesign(rubric: number, dives: DeepDive[]): boolean {
  return rubric < REDESIGN_RUBRIC_BELOW || dives.some(d => d.answered === 0)
}

export function redesignDueAt(nowMs: number): number {
  return startOfLocalDay(addLocalDays(nowMs, REDESIGN_DAYS))
}

export function summaryText(s: { mode: 'solo' | 'interviewer'; minutes: number; rubric: number | null }): string {
  return `${s.mode === 'solo' ? 'Solo' : 'Interviewer'} · ${s.minutes} min · rubric ${s.rubric ?? '–'} / ${RUBRIC_MAX}`
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

import type { HelpRung, Kind, Rung, RungUse } from '../data/types'
import { rungCost } from './ladder'

/** C-LADDER §2.1: Hint unlocks once the Do timer has run ≥ 10:00 in the current attempt cycle. */
export const HINT_UNLOCK_SECONDS = 600
export const MINUS = '−'

export const RUNG_NAMES = ['attempt', 'hint', 'picture', 'video', 'solution'] as const
export type RungName = (typeof RUNG_NAMES)[number]
export const RUNG_LABEL: Record<RungName, string> = { attempt: 'Attempt', hint: 'Hint', picture: 'Picture', video: 'Video', solution: 'Solution' }
export const RUNG_OF: Record<RungName, Rung> = { attempt: 1, hint: 2, picture: 3, video: 4, solution: 5 }

export type RungState = 'locked' | 'unlocked' | 'open' | 'na'
export type UseLike = Pick<RungUse, 'rung' | 'cost'> & { level?: 1 | 2 }

export interface RungView {
  name: RungName
  rung: Rung
  label: string
  state: RungState
  /** current cost (doubled in a redo); null = not available for this ticket kind */
  cost: number | null
  buttonLabel: string
  cube: string
}

export interface LadderInput { kind: Kind; uses: UseLike[]; elapsedSec: number; gaveUp: boolean; redo: boolean }

// Note: foundation's rungCost(kind, rung, opts) takes the ticket Kind directly (not a separate
// CostKind), applying its own costKind() mapping internally (Task 1 finding).
export function costOf(kind: Kind, rung: Rung, redo: boolean): number | null {
  return rung === 1 ? 0 : rungCost(kind, rung as HelpRung, { redo })
}

function stateOf(rung: Rung, cost: number | null, opened: Set<number>, i: LadderInput): RungState {
  if (rung === 1) return 'open'
  if (cost === null) return 'na'
  if (opened.has(rung)) return 'open'
  if (rung === 2) return i.elapsedSec >= HINT_UNLOCK_SECONDS ? 'unlocked' : 'locked'
  if (rung === 5) return i.gaveUp ? 'unlocked' : 'locked'
  return opened.has(rung - 1) ? 'unlocked' : 'locked'
}

export function buttonLabel(name: RungName, state: RungState, cost: number | null): string {
  const label = RUNG_LABEL[name]
  if (state === 'na') return `${label}, not available for tasks`
  if (state === 'open') return `${label}, opened`
  if (state === 'unlocked') return `Open ${label}, costs ${cost} xp`
  if (name === 'solution') return 'Solution, locked until you give up'
  return `${label}, locked, costs ${cost} xp`
}

export function cubeText(cost: number | null): string {
  if (cost === null) return 'n/a'
  return cost === 0 ? '0' : `${MINUS}${cost}`
}

export function ladderView(i: LadderInput): RungView[] {
  const opened = new Set<number>(i.uses.map(u => u.rung))
  return RUNG_NAMES.map(name => {
    const rung = RUNG_OF[name]
    const cost = costOf(i.kind, rung, i.redo)
    const state = stateOf(rung, cost, opened, i)
    return { name, rung, label: RUNG_LABEL[name], state, cost, buttonLabel: buttonLabel(name, state, cost), cube: cubeText(cost) }
  })
}

export const spentOf = (uses: UseLike[]): number => uses.reduce((a, u) => a + u.cost, 0)
export const spentOn = (uses: UseLike[], rung: Rung): number => spentOf(uses.filter(u => u.rung === rung))
/** Any rung ≥ Hint, zero-cost Video included (C-LADDER H-17). */
export const helpUsed = (uses: UseLike[]): boolean => uses.some(u => u.rung >= 2)
export const deepestOf = (uses: UseLike[]): Rung => uses.reduce<Rung>((m, u) => (u.rung > m ? u.rung : m), 1)
export const sessionRungs = (uses: UseLike[]): Rung[] => [...new Set<Rung>([1, ...uses.map(u => u.rung)])].sort((a, b) => a - b)

export interface NetInput { base: number; solvedEver: boolean; applied: number; refunds: number }
/** C-LADDER §2.3: max(0, base earned − recorded help cost + refunds); base only once solved. */
export function ticketNet(i: NetInput): number {
  return Math.max(0, (i.solvedEver ? i.base : 0) - i.applied + i.refunds)
}

export function newlyUnlocked(prev: RungView[] | null, next: RungView[]): RungView | null {
  if (!prev) return null
  const was = new Map(prev.map(r => [r.name, r.state]))
  const hits = next.filter(r => r.state === 'unlocked' && was.get(r.name) === 'locked')
  return hits.length ? hits[hits.length - 1] : null
}

export const announceText = (r: RungView): string => `${r.label} unlocked, costs ${r.cost} xp`
export const whyText = (label: string, n: number): string => `Why did I pay for this? ${label} cost ${n} xp.`
export const spentText = (n: number): string => `Help spent: ${n} xp`
export const xpSavedText = (delta: number): string => `${delta < 0 ? MINUS : '+'}${Math.abs(delta)} xp · Saved`

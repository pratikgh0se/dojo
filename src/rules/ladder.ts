// XP ledger arithmetic for the help ladder and the redo queue (spec §3). Pure: no React, no Dexie.
// Sources: PLATFORM "Do" (cost table), DATA "XP" and "Redo schedule", TRACKING §3 (second approach),
// ladder contract §2.1 and §2.4. Queueing, resets and fail handling belong to chain H.
import type { HelpRung, Kind, Outcome, RedoStage } from '../data/types'
import { addLocalDays } from '../lib/dates'

export type CostKind = 'problem' | 'design' | 'task'

/** null = the rung does not exist for that ticket kind (Solution on tasks). */
export const RUNG_COST: Record<CostKind, Record<HelpRung, number | null>> = {
  problem: { 2: 2, 3: 3, 4: 3, 5: 5 },
  design: { 2: 3, 3: 4, 4: 3, 5: 5 },
  task: { 2: 2, 3: 2, 4: 0, 5: null },
}
export const REDO_COST_MULTIPLIER = 2
export const REDO_DAYS = [3, 10, 30] as const
export const REDO_BONUS = 3
export const PASS_MAX_RUNG = 2
export const REDO_TRIGGER_RUNG = 3

export function costKind(kind: Kind): CostKind {
  return kind === 'problem' ? 'problem' : kind === 'design' ? 'design' : 'task'
}

export function rungCost(
  kind: Kind,
  rung: HelpRung,
  opts: { redo?: boolean; secondApproach?: boolean } = {},
): number | null {
  const base = RUNG_COST[costKind(kind)][rung]
  if (base === null) return null
  let cost = opts.redo && rung >= 3 ? base * REDO_COST_MULTIPLIER : base
  if (opts.secondApproach && rung === 3) cost = Math.ceil(cost / 2)
  return cost
}

/** Net XP on a ticket is floored at 0; the part of a cost beyond it is recorded but not applied. */
export function applyCost(netXp: number, cost: number): { xp: number; applied: number } {
  const net = Math.max(0, netXp)
  const applied = Math.min(Math.max(0, cost), net)
  return { xp: net - applied, applied }
}

export function redoDue(fromMs: number, stage: RedoStage): number {
  return addLocalDays(fromMs, REDO_DAYS[stage])
}

/** Stage 0 refunds floor(C/2), stage 1 the rest of C, stage 2 a fixed bonus. */
export function redoRefund(stage: RedoStage, helpCost: number, refundedSoFar: number): number {
  if (stage === 2) return REDO_BONUS
  const left = Math.max(0, helpCost - refundedSoFar)
  if (stage === 0) return Math.min(left, Math.floor(helpCost / 2))
  return left
}

export function needsRedo(i: { outcome: Outcome; deepestRung: number }): boolean {
  if (i.outcome === 'gave_up') return true
  return i.outcome === 'solved_help' && i.deepestRung >= REDO_TRIGGER_RUNG
}

export function passesRedo(i: { outcome: Outcome; deepestRung: number }): boolean {
  return (i.outcome === 'solved' || i.outcome === 'solved_help') && i.deepestRung <= PASS_MAX_RUNG
}

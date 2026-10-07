import type { PlanJson, PlanShelfItem, StageSession, Ticket } from '../data/types'

export const STAGE_SESSIONS: readonly StageSession[] = ['watch', 'rebuild', 'build', 'teachback']
export const SESSION_LABELS: Record<StageSession, string> = { watch: 'Watch', rebuild: 'Rebuild', build: 'Build', teachback: 'Teach-back' }

export interface StageBand { stage: number; title: string; from: number; to: number }
export type StageState = 'done' | 'current' | 'behind' | 'upcoming'
export interface StageRow { sprint: number; cells: Record<StageSession, Ticket | null> }
export interface StageProgress { state: StageState; done: number; total: number; rows: StageRow[] }
export interface ShelfGroup { skill: string; label: string; items: PlanShelfItem[] }

export function stageLabel(stage: number): string {
  return `Stage ${String(stage).padStart(2, '0')}`
}

function stageTitle(focusAi: string, stage: number): string {
  const t = focusAi.replace(/^Stage\s+\d+\s*:\s*/i, '').trim()
  return t || stageLabel(stage)
}

export function stageBands(plan: PlanJson): StageBand[] {
  const acc = new Map<number, StageBand>()
  for (const s of plan.sprints) {
    for (const t of s.ai) {
      if (t.kind !== 'stage' || typeof t.stage !== 'number') continue
      const b = acc.get(t.stage)
      if (!b) {
        acc.set(t.stage, { stage: t.stage, title: stageTitle(s.focus_ai, t.stage), from: s.sprint, to: s.sprint })
        continue
      }
      if (s.sprint < b.from) {
        b.from = s.sprint
        b.title = stageTitle(s.focus_ai, t.stage)
      }
      if (s.sprint > b.to) b.to = s.sprint
    }
  }
  return [...acc.values()].sort((a, b) => a.stage - b.stage)
}

export function stageProgress(band: StageBand, tickets: Ticket[], currentSprint: number): StageProgress {
  const mine = tickets
    .filter(t => !t.archived && t.childOf === undefined && t.kind === 'stage' && t.stage === band.stage)
    .sort((a, b) => a.order - b.order)
  const done = mine.filter(t => t.status === 'done').length
  const total = mine.length
  const rows: StageRow[] = []
  for (let s = band.from; s <= band.to; s++) {
    const cells = {} as Record<StageSession, Ticket | null>
    for (const k of STAGE_SESSIONS) cells[k] = mine.find(t => t.plannedSprint === s && t.session === k) ?? null
    rows.push({ sprint: s, cells })
  }
  const state: StageState =
    total > 0 && done === total ? 'done'
      : currentSprint > band.to ? 'behind'
        : currentSprint >= band.from ? 'current'
          : 'upcoming'
  return { state, done, total, rows }
}

export function defaultStage(bands: StageBand[], progress: Map<number, StageProgress>): StageBand | null {
  return (
    bands.find(b => progress.get(b.stage)?.state === 'current') ??
    bands.find(b => progress.get(b.stage)?.state !== 'done') ??
    bands[0] ??
    null
  )
}

export function sessionBalance(tickets: Ticket[]): Record<StageSession, { done: number; total: number }> {
  const out = {} as Record<StageSession, { done: number; total: number }>
  for (const k of STAGE_SESSIONS) out[k] = { done: 0, total: 0 }
  for (const t of tickets) {
    if (t.archived || t.childOf !== undefined || t.kind !== 'stage' || !t.session) continue
    out[t.session].total++
    if (t.status === 'done') out[t.session].done++
  }
  return out
}

export function shelfBySkill(plan: PlanJson): ShelfGroup[] {
  const labels = new Map((plan.skills ?? []).map(s => [s.id, s.label]))
  const groups = new Map<string, ShelfGroup>()
  for (const it of plan.ai_shelf ?? []) {
    const g = groups.get(it.skill) ?? { skill: it.skill, label: labels.get(it.skill) ?? it.skill, items: [] }
    g.items.push(it)
    groups.set(it.skill, g)
  }
  return [...groups.values()]
}

/** Stage after which the checkpoint marker sits: the last band that ends at or before the checkpoint sprint. */
export function checkpointAfterStage(bands: StageBand[], checkpoint: number): number | null {
  const before = bands.filter(b => b.to <= checkpoint)
  return before.length ? before[before.length - 1].stage : null
}

/** The capstone always has 12 stages, numbered 00–11 (see the Timeline in the forge capstone spec). */
export const STAGE_COUNT = 12

export interface StageBadge { stage: number; cleared: boolean }

/**
 * One badge per capstone stage (Stage 00–11), earned when every non-archived stage
 * ticket for that stage is done. Reads ticket.stage directly, so it needs no plan
 * data (unlike stageBands) and reports every stage as un-cleared, not absent, on a
 * plan with no stage tickets at all.
 */
export function stageBadges(tickets: Ticket[]): StageBadge[] {
  const live = tickets.filter(t => !t.archived && t.childOf === undefined && t.kind === 'stage')
  return Array.from({ length: STAGE_COUNT }, (_, stage) => {
    const mine = live.filter(t => t.stage === stage)
    return { stage, cleared: mine.length > 0 && mine.every(t => t.status === 'done') }
  })
}

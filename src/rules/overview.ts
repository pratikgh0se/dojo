import type { PlanJson } from '../data/types'
import { isIsoDate, localDayKey } from '../lib/dates'
import { stageBands, stageLabel } from './capstone'
import { phaseSprints } from './map'
import { tierRange } from './planTickets'
import { planPosition, SPRINTS_PER_BLOCK, sprintStart, TOTAL_SPRINTS } from './sprint'

/** The forge plan's checkpoint sprint (spec: the only hard-coded sprint in M5). */
export const CHECKPOINT_SPRINT = 38

export interface Band { label: string; from: number; to: number }

export interface Timeline {
  phases: Band[]
  stages: Band[]
  designs: Band | null
  checkpoint: number
  now: number | null
  total: number
}

export function timelineBands(plan: PlanJson, startDate: string, nowMs: number, lastSprint: number = TOTAL_SPRINTS): Timeline {
  const phases = (plan.phases ?? [])
    .filter(p => p.months.length > 0)
    .map(p => { const [from, to] = phaseSprints(p); return { label: p.n, from, to } })
  const stages = stageBands(plan).map(b => ({ label: `${stageLabel(b.stage)} · ${b.title}`, from: b.from, to: b.to }))
  const ranges = plan.design_bank.map(t => tierRange(t.tier))
  const designs = ranges.length
    ? { label: 'Design bank', from: Math.min(...ranges.map(r => r[0])), to: Math.max(...ranges.map(r => r[1])) }
    : null
  let now: number | null = null
  if (isIsoDate(startDate)) {
    const pos = planPosition(nowMs, startDate, lastSprint)
    if (pos.phase === 'active') now = pos.sprint
  }
  const total = Math.max(TOTAL_SPRINTS, lastSprint, ...plan.sprints.map(s => s.sprint))
  return { phases, stages, designs, checkpoint: CHECKPOINT_SPRINT, now, total }
}

export function timelineTicks(startDate: string, total: number = TOTAL_SPRINTS): { sprint: number; label: string }[] {
  const out: { sprint: number; label: string }[] = []
  for (let s = 1; s <= total; s += SPRINTS_PER_BLOCK) {
    out.push({ sprint: s, label: isIsoDate(startDate) ? `S${s} · ${localDayKey(sprintStart(s, startDate))}` : `S${s}` })
  }
  return out
}

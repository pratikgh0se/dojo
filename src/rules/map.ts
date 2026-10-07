import type { PlanJson, PlanPhase, PlanSkill, Status, Ticket } from '../data/types'
import { blockSprints } from './sprint'

export const UNLOCK_AT = 0.7

export type SkillState = 'done' | 'active' | 'open' | 'locked'
export interface SkillProgress { done: number; total: number; pct: number }
export type SkillProgressMap = Record<string, SkillProgress>

export interface JourneyStop { n: string; note: string; firstSprint: number; lastSprint: number; state: 'done' | 'current' | 'upcoming' }
export interface PathSprint { sprint: number; cubes: Status[]; cleared: boolean; current: boolean }
export interface PathRow { from: number; to: number; title: string; sprints: PathSprint[] }
export interface SprintView {
  sprint: number
  block: number
  blockTitle: string
  blockTheme: string
  focusAi: string
  focusInterview: string
  proof: string | null
  ai: Ticket[]
  interview: Ticket[]
}

const ZERO: SkillProgress = { done: 0, total: 0, pct: 0 }

export function skillProgress(skills: PlanSkill[], tickets: Ticket[]): SkillProgressMap {
  const out: SkillProgressMap = {}
  for (const s of skills) out[s.id] = { done: 0, total: 0, pct: 0 }
  for (const t of tickets) {
    // ruling 20 S4: a split card counts once, as itself
    if (t.archived || t.childOf !== undefined || !t.skill || !out[t.skill]) continue
    out[t.skill].total++
    if (t.status === 'done') out[t.skill].done++
  }
  for (const p of Object.values(out)) p.pct = p.total ? p.done / p.total : 0
  return out
}

function evaluate(skills: PlanSkill[], progress: SkillProgressMap, unlockAt: number) {
  const byId = new Map(skills.map(s => [s.id, s]))
  const states: Record<string, SkillState> = {}
  const gates: Record<string, boolean> = {}
  const visiting = new Set<string>()
  const prog = (id: string) => progress[id] ?? ZERO

  // A skill's gate: may its children unlock? Ticketed: at ≥ unlockAt. Zero tickets: nothing
  // to finish, so it passes its own lock status through (never blocks forever, never leaks a lock).
  const gateOpen = (id: string): boolean => {
    if (id in gates) return gates[id]
    const p = prog(id)
    const open = p.total > 0 ? p.pct >= unlockAt : stateOf(id) !== 'locked'
    gates[id] = open
    return open
  }

  const stateOf = (id: string): SkillState => {
    if (states[id]) return states[id]
    const s = byId.get(id)
    if (!s || visiting.has(id)) return 'locked' // unknown id or a cycle in `needs`
    visiting.add(id)
    const parentsOpen = s.needs.every(n => !byId.has(n) || gateOpen(n))
    visiting.delete(id)
    const p = prog(id)
    const st: SkillState = p.total > 0 && p.done === p.total ? 'done' : !parentsOpen ? 'locked' : p.done > 0 ? 'active' : 'open'
    states[id] = st
    return st
  }

  for (const s of skills) {
    stateOf(s.id)
    gateOpen(s.id)
  }
  return { states, gates }
}

export function skillStates(skills: PlanSkill[], progress: SkillProgressMap, unlockAt = UNLOCK_AT): Record<string, SkillState> {
  return evaluate(skills, progress, unlockAt).states
}

export function skillGates(skills: PlanSkill[], progress: SkillProgressMap, unlockAt = UNLOCK_AT): Record<string, boolean> {
  return evaluate(skills, progress, unlockAt).gates
}

export function skillTreeLayout(skills: PlanSkill[]): { nodes: { id: string; col: number; row: number }[]; edges: { from: string; to: string }[] } {
  const rows = new Map<number, number>()
  const nodes = skills.map(s => {
    const row = rows.get(s.tier) ?? 0
    rows.set(s.tier, row + 1)
    return { id: s.id, col: s.tier, row }
  })
  const ids = new Set(skills.map(s => s.id))
  const edges = skills.flatMap(s => s.needs.filter(n => ids.has(n)).map(n => ({ from: n, to: s.id })))
  return { nodes, edges }
}

export function phaseSprints(p: PlanPhase): [number, number] {
  return [blockSprints(Math.min(...p.months))[0], blockSprints(Math.max(...p.months))[1]]
}

export function journey(phases: PlanPhase[], currentSprint: number): JourneyStop[] {
  return phases
    .filter(p => p.months.length > 0)
    .map(p => {
      const [firstSprint, lastSprint] = phaseSprints(p)
      const state: JourneyStop['state'] = currentSprint > lastSprint ? 'done' : currentSprint >= firstSprint ? 'current' : 'upcoming'
      return { n: p.n, note: p.note, firstSprint, lastSprint, state }
    })
}

const NO_PLAN_DATA = 'No plan data'

// Rows group runs of consecutive sprints that share the same block_title — since the forge
// rewrite these runs are the capstone stages, which no longer align to the fixed 4-sprint
// `block` field. `lastSprint` extends the range past the plan's own sprints (e.g. a ticket
// slid beyond S72) so live tickets stay visible; sprints with no plan data of their own are
// grouped under "No plan data".
export function sprintPath(plan: PlanJson, tickets: Ticket[], currentSprint: number, lastSprint?: number): PathRow[] {
  const homed = new Map<number, Ticket[]>()
  for (const t of tickets) {
    if (t.archived || t.origin !== 'plan') continue
    const list = homed.get(t.sprint) ?? []
    list.push(t)
    homed.set(t.sprint, list)
  }
  const titleBySprint = new Map(plan.sprints.map(s => [s.sprint, s.block_title]))
  const maxPlanSprint = plan.sprints.reduce((m, s) => Math.max(m, s.sprint), 0)
  const upper = Math.max(maxPlanSprint, lastSprint ?? 0)

  const rows: PathRow[] = []
  let row: PathRow | null = null
  for (let sprint = 1; sprint <= upper; sprint++) {
    const title = titleBySprint.get(sprint) ?? NO_PLAN_DATA
    const ts = (homed.get(sprint) ?? []).sort((x, y) => x.order - y.order)
    const pathSprint: PathSprint = {
      sprint,
      cubes: ts.map(t => t.status),
      cleared: ts.length > 0 && ts.every(t => t.status === 'done'),
      current: sprint === currentSprint,
    }
    if (row && row.title === title) {
      row.to = sprint
      row.sprints.push(pathSprint)
    } else {
      row = { from: sprint, to: sprint, title, sprints: [pathSprint] }
      rows.push(row)
    }
  }
  return rows
}

export function sprintView(plan: PlanJson, tickets: Ticket[], sprint: number): SprintView | null {
  const s = plan.sprints.find(x => x.sprint === sprint)
  if (!s) return null
  const homed = tickets.filter(t => !t.archived && t.origin === 'plan' && t.sprint === sprint).sort((a, b) => a.order - b.order)
  return {
    sprint, block: s.block, blockTitle: s.block_title, blockTheme: s.block_theme, focusAi: s.focus_ai,
    focusInterview: s.focus_interview, proof: s.proof, ai: homed.filter(t => t.track === 'ai'),
    interview: homed.filter(t => t.track === 'interview'),
  }
}

export function skillSprints(skillId: string, tickets: Ticket[]): number[] {
  return [...new Set(tickets.filter(t => !t.archived && t.skill === skillId).map(t => t.sprint))].sort((a, b) => a - b)
}

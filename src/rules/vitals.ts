import type { Ticket } from '../data/types'
import { addLocalDays, weekdayOf, type Weekday } from '../lib/dates'
import { blockSprints, effSprint, SPRINT_DAYS, sprintStart } from './sprint'
import { isRestRole } from './today'
import { isContainer } from './brief'
import { isPart } from './units'

export const GRAPH_BADGE_LAST_SPRINT = 4
export const HARD_BADGE = 10
export const DESIGN_BADGE = 5

const live = (t: Ticket) => !t.archived && t.status !== 'slid'
const done = (t: Ticket) => t.status === 'done'

const isTaskKind = (t: Ticket) => t.kind === 'task' || t.kind === 'stage' || t.kind === 'watch' || t.kind === 'read'

/**
 * A plan "task" (prototype sprints[].ai + interview): kind task or stage, live, not a slid history row. Ruling 20 S4: a
 * task is counted once: a split card counts as itself (done when all its parts are), never through its parts.
 */
export function isSprintTask(t: Ticket): boolean {
  return live(t) && !isPart(t) && isTaskKind(t)
}

/** The sprint's tasks as counted items (Carrot HP, "This sprint n/m", the load check): a split card counts once. */
export function sprintTasks(tickets: Ticket[], sprint: number): Ticket[] {
  return tickets.filter(t => isSprintTask(t) && effSprint(t) === sprint).sort((a, b) => a.order - b.order)
}

/** Task work (what can be done or slid): a split card's parts, not the card itself. */
export function isTaskWork(t: Ticket): boolean {
  return live(t) && isTaskKind(t) && !isContainer(t)
}

export function sprintTaskWork(tickets: Ticket[], sprint: number): Ticket[] {
  return tickets.filter(t => isTaskWork(t) && effSprint(t) === sprint).sort((a, b) => a.order - b.order)
}

export type DayCell = 'past' | 'past-rest' | 'today' | 'future'

export function sprintDays(
  startDate: string, sprint: number, dayInSprint: number, rotation: Partial<Record<Weekday, string>>,
): DayCell[] {
  const first = sprintStart(sprint, startDate)
  return Array.from({ length: SPRINT_DAYS }, (_, i): DayCell => {
    const day = i + 1
    if (day === dayInSprint) return 'today'
    if (day > dayInSprint) return 'future'
    return isRestRole(rotation[weekdayOf(addLocalDays(first, i))] ?? '') ? 'past-rest' : 'past'
  })
}

export function sprintDates(startDate: string, sprint: number): string {
  const f = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const a = sprintStart(sprint, startDate)
  return `${f(a)} – ${f(addLocalDays(a, SPRINT_DAYS - 1))}`
}

export function carrotHp(tickets: Ticket[], sprint: number): { max: number; left: number } {
  const ts = sprintTasks(tickets, sprint)
  return { max: ts.length, left: ts.filter(t => !done(t)).length }
}

export interface Badge { glyph: string; hint: string; on: boolean }

export function milestoneBadges(tickets: Ticket[]): Badge[] {
  const all = tickets.filter(live)
  const tasks = all.filter(isSprintTask)
  const problems = all.filter(t => t.kind === 'problem' && t.origin === 'plan')
  const graph = problems.filter(p => p.plannedSprint <= GRAPH_BADGE_LAST_SPRINT)
  const hard = problems.filter(p => p.difficulty === 'H' && done(p)).length
  const designs = all.filter(t => t.kind === 'design' && t.origin === 'plan' && done(t)).length
  const [b1, b2] = blockSprints(1)
  const block1 = tasks.filter(t => t.plannedSprint >= b1 && t.plannedSprint <= b2)
  const half = Math.ceil(tasks.length / 2)
  return [
    { glyph: '1', hint: 'First tick', on: all.some(done) },
    { glyph: 'G', hint: `Graph walker · sprints 1–${GRAPH_BADGE_LAST_SPRINT} DSA clear`, on: graph.length > 0 && graph.every(done) },
    { glyph: 'H', hint: `Ten hards · ${hard}/${HARD_BADGE}`, on: hard >= HARD_BADGE },
    { glyph: 'D', hint: `Designer · ${Math.min(designs, DESIGN_BADGE)}/${DESIGN_BADGE} designs`, on: designs >= DESIGN_BADGE },
    { glyph: 'B', hint: 'Block one clear', on: block1.length > 0 && block1.every(done) },
    { glyph: '½', hint: `Halfway · ${half} ${half === 1 ? 'task' : 'tasks'}`, on: tasks.length > 0 && tasks.filter(done).length >= half },
  ]
}

export type PomPose = 'idle' | 'training' | 'powerup'

export function pomPose(powered: boolean, tickets: Ticket[], sprint: number): PomPose {
  if (powered) return 'powerup'
  return sprintTasks(tickets, sprint).some(done) ? 'training' : 'idle'
}

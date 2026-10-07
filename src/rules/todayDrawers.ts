import type { PlanJson, Ticket } from '../data/types'
import { WEEKDAYS, type Weekday } from '../lib/dates'
import { designTiers, type DesignItemView, type DesignTierView } from './designs'
import { dsaTopics, type DsaTopicView } from './dsa'
import { leftBehind } from './load'
import { effSprint } from './sprint'
import { sprintTasks } from './vitals'

export const CARRY_ROWS = 30
export const CARRY_CUBES = 24

const DAY_NAME: Record<Weekday, string> = {
  Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday',
}

export interface DrawerHead { title: string; sub: string; cubes: boolean[]; done: number; total: number }
export interface TasksDrawer extends DrawerHead { ai: Ticket[]; interview: Ticket[]; focusAi: string; focusInterview: string }
export interface CarryDrawer extends DrawerHead { rows: Array<{ ticket: Ticket; tag: string }> }
export interface DsaDrawer extends DrawerHead { topic: DsaTopicView }
export interface DesignDrawer extends DrawerHead { tier: DesignTierView; item: DesignItemView | null }
export interface TodayDrawerModel { tasks: TasksDrawer; carry: CarryDrawer | null; dsa: DsaDrawer | null; design: DesignDrawer | null }

const isDone = (t: Ticket) => t.status === 'done'

export function todayDrawers(plan: PlanJson, tickets: Ticket[], sprint: number): TodayDrawerModel {
  const ps = plan.sprints.find(s => s.sprint === sprint)
  const cur = sprintTasks(tickets, sprint)
  const ai = cur.filter(t => t.track === 'ai')
  const interview = cur.filter(t => t.track === 'interview')
  const all = [...ai, ...interview]
  const tasks: TasksDrawer = {
    title: `This sprint · ${all.length} ${all.length === 1 ? 'task' : 'tasks'}`,
    sub: ps ? `${ps.focus_ai} · ${ps.focus_interview}` : '',
    cubes: all.map(isDone), done: all.filter(isDone).length, total: all.length,
    ai, interview, focusAi: ps?.focus_ai ?? '', focusInterview: ps?.focus_interview ?? '',
  }

  const over = leftBehind(tickets, sprint)
  const carry: CarryDrawer | null = over.length === 0 ? null : {
    title: `Left behind · ${over.length}`, sub: 'Unticked tasks from earlier sprints',
    cubes: over.slice(0, CARRY_CUBES).map(() => false), done: 0, total: over.length,
    rows: over.slice(0, CARRY_ROWS).map(t => ({ ticket: t, tag: `from sprint ${effSprint(t)} · ${t.track === 'ai' ? 'AI' : 'interview'}` })),
  }

  const topics = dsaTopics(plan, tickets)
  const eligible = topics.filter(t => t.sprint <= sprint)
  const topic = eligible[eligible.length - 1] ?? topics[0]
  const dsa: DsaDrawer | null = topic ? {
    title: `DSA · ${topic.topic.split(':')[0]}`, sub: topic.pattern,
    cubes: topic.problems.map(p => p.solved), done: topic.solved, total: topic.total, topic,
  } : null

  const tier = designTiers(plan, tickets).find(t => sprint >= t.from && sprint <= t.to)
  const day = WEEKDAYS.find(d => /design/i.test(plan.rotation[d] ?? ''))
  const item = tier?.items.find(i => !i.done) ?? null
  const design: DesignDrawer | null = tier ? {
    title: day ? `${DAY_NAME[day]} design` : 'Design', sub: item ? item.title : 'Tier complete',
    cubes: tier.items.map(i => i.done), done: tier.done, total: tier.total, tier, item,
  } : null

  return { tasks, carry, dsa, design }
}

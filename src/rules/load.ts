import type { Ticket } from '../data/types'
import { minutesOf } from './brief'
import { effSprint, SPRINT_DAYS, TOTAL_SPRINTS } from './sprint'
import { isSprintTask, isTaskWork, sprintTasks } from './vitals'
import { hoursText, isOverBudget } from './workload'

export const HEALTH_WINDOW = 8
export const HEAVY_RATIO = 1.3
export const HEAVY_MIN_GAP = 2

const done = (t: Ticket) => t.status === 'done'
const tasksText = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`

/** Unticked tasks from earlier sprints, each counted once; `work`: a split card's open parts instead of the card. */
export function leftBehind(tickets: Ticket[], sprint: number, work = false): Ticket[] {
  return tickets
    .filter(t => (work ? isTaskWork(t) : isSprintTask(t)) && effSprint(t) < sprint && !done(t))
    .sort((a, b) => effSprint(a) - effSprint(b) || a.order - b.order)
}

export interface HealthColumn { sprint: number; label: string; done: number; behind: number; todo: number }

export function healthColumns(tickets: Ticket[], cw: number, nowLabel = 'NOW'): HealthColumn[] {
  const lo = Math.max(1, Math.min(cw - 5, TOTAL_SPRINTS - (HEALTH_WINDOW - 1)))
  const hi = Math.min(TOTAL_SPRINTS, lo + HEALTH_WINDOW - 1)
  const out: HealthColumn[] = []
  for (let w = lo; w <= hi; w++) {
    const ts = sprintTasks(tickets, w)
    const d = ts.filter(done).length
    const open = ts.length - d
    out.push({ sprint: w, label: w === cw ? nowLabel : `S${w}`, done: d, behind: w < cw ? open : 0, todo: w >= cw ? open : 0 })
  }
  return out
}

export type StatTone = 'ok' | 'danger' | 'plain'
export interface HealthStat { label: string; value: string; tone: StatTone; tip?: string }

export function healthStats(tickets: Ticket[], cw: number): HealthStat[] {
  const cur = sprintTasks(tickets, cw)
  const over = leftBehind(tickets, cw).length
  const prev: HealthStat = cw > 1
    ? (() => {
        const p = sprintTasks(tickets, cw - 1)
        const d = p.filter(done).length
        return { label: `Sprint ${cw - 1}`, value: `${d}/${p.length}`, tone: d === p.length ? 'ok' : 'plain' }
      })()
    : { label: 'Last sprint', value: '—', tone: 'plain' }
  return [
    prev,
    {
      label: 'This sprint', value: `${cur.filter(done).length}/${cur.length}`, tone: 'plain',
      tip: `${cur.filter(done).length} of ${cur.length} plan tasks done this sprint (AI and interview tasks; the Board also counts DSA cards)`,
    },
    { label: 'Left behind', value: String(over), tone: over > 0 ? 'danger' : 'ok' },
  ]
}

export type LoadCell = 'done' | 'behind' | 'todo'
export interface LoadRow { label: string; n: number; cells: LoadCell[] }
export interface LoadCheck {
  rows: LoadRow[]; heavy: boolean; verdict: 'Heavy' | 'Fits'; due: number; cap: number; pace: number | null; text: string
}

const row = (label: string, a: number, b: number, c: number): LoadRow => ({
  label,
  n: a + b + c,
  cells: [...Array<LoadCell>(a).fill('done'), ...Array<LoadCell>(b).fill('behind'), ...Array<LoadCell>(c).fill('todo')],
})

/**
 * DATA.md "Load check (formalised)", ported from the prototype:
 * due = leftBehind + remainingThisSprint; pace = pastDone / (cw − 1) when there is history,
 * else null; cap = pace ? max(1, round(pace)) : this sprint's size;
 * Heavy when due > cap × 1.3 && due − cap ≥ 2.
 *
 * Ruling 24 S2 (cu-2 P2-2): a pace needs data. Until the first sprint has ended, or a week of focus has been logged,
 * the verdict judges only the plan: Heavy when the sprint's planned minutes are over the core-minutes budget, and any
 * advice to slide comes from that excess, never from a pace made of one finished block.
 */
export interface FocusPace {
  /** real focus minutes per sprint (the runner's `focus` events over the last 7 days, doubled to a 14-day sprint) */
  perSprint: number
  /** whole local days since the first logged focus minute; a pace in the first sprint waits for PACE_MIN_FOCUS_DAYS of them */
  historyDays?: number
}
/** The sprint's planned minutes still to do, and the core-minutes budget they are judged against (Fits / Heavy by plan). */
export interface PlanLoad { planned: number; budget: number }

/** Days of logged focus that earn a pace inside the first sprint. */
export const PACE_MIN_FOCUS_DAYS = 7
/** Whether a pace may be shown at all: the first sprint has ended, or a week of focus has been logged. */
export const paceKnown = (cw: number, f: FocusPace | undefined): boolean => cw > 1 || (f?.historyDays ?? 0) >= PACE_MIN_FOCUS_DAYS

/** Tasks a sprint at this much real focus: minutes / the average minutes of this sprint's tasks
 *  (a card's brief minutes, else its estimate - briefs spec §3; 50 when none). */
function focusPace(cur: Ticket[], f: FocusPace | undefined): number | null {
  if (!f || !(f.perSprint > 0)) return null
  const est = cur.length ? cur.reduce((a, t) => a + (minutesOf(t) > 0 ? minutesOf(t) : 50), 0) / cur.length : 50
  return f.perSprint / est
}

export function loadCheck(tickets: Ticket[], cw: number, dayInSprint: number, focus?: FocusPace, plan?: PlanLoad): LoadCheck {
  const cur = sprintTasks(tickets, cw)
  const over = leftBehind(tickets, cw).length
  const curLeft = cur.filter(t => !done(t)).length
  const nextW = Math.min(TOTAL_SPRINTS, cw + 1)
  const nextN = cw < TOTAL_SPRINTS ? sprintTasks(tickets, cw + 1).length : 0
  const pastDone = tickets.filter(t => isSprintTask(t) && effSprint(t) < cw && done(t)).length
  const donePace = cw > 1 && pastDone > 0 ? pastDone / (cw - 1) : null
  const fp = paceKnown(cw, focus) ? focusPace(cur, focus) : null
  // real focus minutes: the whole pace when there is no history, else averaged with the done pace
  const pace = donePace !== null && fp !== null ? (donePace + fp) / 2 : donePace ?? fp
  const due = over + curLeft
  // S2: while there is no data for a pace the verdict is the plan against the budget; the cards to slide are the excess
  // in average cards
  const firstSprint = !paceKnown(cw, focus)
  const byPlan = firstSprint && plan !== undefined && isOverBudget(plan.planned, plan.budget)
  const planSlide = byPlan ? Math.min(due, Math.max(1, Math.ceil((plan.planned - plan.budget) / Math.max(1, plan.planned / Math.max(1, due))))) : 0
  const cap = pace !== null ? Math.max(1, Math.round(pace)) : byPlan ? due - planSlide : cur.length
  const heavy = firstSprint ? byPlan : due > cap * HEAVY_RATIO && due - cap >= HEAVY_MIN_GAP
  const slide = byPlan ? planSlide : due - cap
  const AFTER_FIRST = 'Your pace appears here after the first sprint ends.'
  const text = byPlan
    ? `${tasksText(due)} due this sprint, ${hoursText(plan.planned)} h planned against the ${hoursText(plan.budget)} h core-minutes budget. Pick the ${slide} least important and let them slide one sprint; the plan's rule is slide, never restart. ${AFTER_FIRST}`
    : heavy
      ? `${tasksText(due)} due before sprint ${nextW} against a pace of about ${cap} per sprint. Pick the ${slide} least important and let them slide one sprint; the plan's rule is slide, never restart.`
      : pace !== null
        ? `${tasksText(due)} due before sprint ${nextW}; you have been clearing about ${cap} a sprint. Keep the rhythm.`
        : `${tasksText(due)} due this sprint. ${AFTER_FIRST}`
  return {
    rows: [
      row(`Now · ${SPRINT_DAYS + 1 - Math.max(1, dayInSprint)}d left`, 0, over, curLeft),
      row(`Sprint ${nextW}`, 0, 0, nextN),
      row(pace !== null ? 'Your pace' : 'Planned pace', cap, 0, 0),
    ],
    heavy, verdict: heavy ? 'Heavy' : 'Fits', due, cap, pace, text,
  }
}

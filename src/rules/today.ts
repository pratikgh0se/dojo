import type { Link, StageSession, Ticket } from '../data/types'
import { WEEKDAYS, type Weekday } from '../lib/dates'
import { effSprint, SPRINT_DAYS, TOTAL_SPRINTS, type PlanPosition } from './sprint'

export type TodayView =
  | { kind: 'before'; eyebrow: string; daysUntil: number }
  | { kind: 'after'; eyebrow: string; unfinished: number }
  | { kind: 'rest'; eyebrow: string; role: string }
  | { kind: 'clear'; eyebrow: string; role: string }
  | { kind: 'work'; eyebrow: string; role: string; tickets: Ticket[]; primary: Ticket }

export function isRestRole(role: string): boolean {
  return /\boff\b/i.test(role)
}

/** UAT J3/J7: a split card is a container while it has parts; its parts (in its place, in order) are the cards. */
export function sprintPool(tickets: Ticket[], sprint: number): Ticket[] {
  return tickets.filter(t => !t.archived && effSprint(t) === sprint && t.status !== 'done' && !(t.children?.length)).sort((a, b) => a.order - b.order)
}

/**
 * Ruling 22 D1: the day plan picks plan items, not sessions. A split card is one item, at its first open part's place
 * in the pool; once picked, its open parts stand in its place, in order, in the same slot. Done parts are not in the
 * pool, so they drop out, and everything else the slot held stays (the parts' minutes sum to the card's).
 */
export function pickToday(role: string, pool: Ticket[]): Ticket[] {
  const runs = new Map<string, Ticket[]>()
  const items: Ticket[] = []
  for (const t of pool) {
    if (t.childOf === undefined) { items.push(t); continue }
    const run = runs.get(t.childOf)
    if (run) run.push(t)
    else { runs.set(t.childOf, [t]); items.push(t) }
  }
  return pickItems(role, items).flatMap(t => (t.childOf !== undefined ? runs.get(t.childOf) ?? [t] : [t]))
}

/** The rotation's slot for one day, over plan items (a split card stands as one item, ruling 22 D1). */
function pickItems(role: string, pool: Ticket[]): Ticket[] {
  const ai = pool.filter(t => t.track === 'ai')
  const iv = pool.filter(t => t.track === 'interview')
  let picked: Ticket[] = []
  if (/^ai\b/i.test(role)) {
    // Rotation text for an AI day spells out the week's stage session in its own
    // words ("AI · watch", "AI · rebuild", "AI · build + break"). 'rebuild' must
    // be checked before the bare 'build' test below, since 'rebuild' also
    // contains the substring 'build' — order here is load-bearing, not cosmetic.
    let session: Ticket['session'] | undefined
    if (/rebuild/i.test(role)) session = 'rebuild'
    else if (/watch/i.test(role)) session = 'watch'
    else if (/build/i.test(role)) session = 'build'
    const stagePicked = session ? ai.filter(t => t.kind === 'stage' && t.session === session).slice(0, 1) : []
    picked = stagePicked.length > 0 ? stagePicked : ai.slice(0, 1)
  } else if (/design/i.test(role)) {
    picked = iv.filter(t => t.kind === 'design').slice(0, 1)
    if (picked.length === 0) picked = iv.slice(0, 1)
  } else if (/code/i.test(role)) {
    // ruling 22 D1: a split problem is one of the two (its parts stand in its place, see pickToday)
    picked = iv.filter(t => t.kind === 'problem').slice(0, 2)
    if (picked.length === 0) picked = iv.filter(t => t.kind === 'task').slice(0, 1)
  } else if (/interview/i.test(role)) {
    // Sunday ("Interview + teach-back", ruling D3 revisited): the sprint's own
    // undone teach-back stage ticket leads, with interview tickets still listed
    // after it; only when there's no teach-back ticket does the old
    // interview-only behavior apply.
    const teachback = ai.filter(t => t.kind === 'stage' && t.session === 'teachback').slice(0, 1)
    picked = teachback.length > 0 ? [...teachback, ...iv.slice(0, 2)] : iv.slice(0, 3)
  }
  if (picked.length === 0) picked = pool.slice(0, 1)
  return picked
}

export function todayView(
  pos: PlanPosition,
  rotation: Partial<Record<Weekday, string>>,
  tickets: Ticket[],
  startDate: string,
): TodayView {
  if (pos.phase === 'before') return { kind: 'before', eyebrow: `PLAN STARTS ${startDate}`, daysUntil: pos.daysUntil }
  if (pos.phase === 'after') {
    const unfinished = tickets.filter(t => !t.archived && t.status !== 'done').length
    return { kind: 'after', eyebrow: `PLAN COMPLETE · ${TOTAL_SPRINTS} OF ${TOTAL_SPRINTS}`, unfinished }
  }
  const role = rotation[pos.weekday] ?? ''
  const eyebrow = `SPRINT ${pos.sprint} · DAY ${pos.dayInSprint} OF ${SPRINT_DAYS}${role ? ` · ${role}` : ''}`
  if (isRestRole(role)) return { kind: 'rest', eyebrow, role }
  const pool = sprintPool(tickets, pos.sprint)
  const picked = pickToday(role, pool)
  if (picked.length === 0) return { kind: 'clear', eyebrow, role }
  return { kind: 'work', eyebrow, role, tickets: picked, primary: picked[0] }
}

export interface UpcomingItem {
  ticket: Ticket
  weekday: Weekday | null
  label: string
  firstLink?: Link
}

// Same role-text matching pickToday uses for AI days: 'rebuild' is checked before the
// bare 'build' test because 'rebuild' also contains the substring 'build' — order here
// is load-bearing, not cosmetic.
function roleStageSession(role: string): StageSession | undefined {
  if (!/^ai\b/i.test(role)) return undefined
  if (/rebuild/i.test(role)) return 'rebuild'
  if (/watch/i.test(role)) return 'watch'
  if (/build/i.test(role)) return 'build'
  return undefined
}

function weekdayFor(t: Ticket, rotation: Partial<Record<Weekday, string>>): Weekday | null {
  const days = WEEKDAYS.filter(d => rotation[d] !== undefined)
  if (t.kind === 'stage') {
    if (t.session === 'teachback') {
      return (
        days.find(d => /teach/i.test(rotation[d]!)) ?? days.find(d => /interview/i.test(rotation[d]!)) ?? null
      )
    }
    return days.find(d => roleStageSession(rotation[d]!) === t.session) ?? null
  }
  if (t.kind === 'design') return days.find(d => /design/i.test(rotation[d]!)) ?? null
  return days.find(d => /code/i.test(rotation[d]!)) ?? null
}

// Before the plan starts, Today has nothing due — this lists Sprint 1's tickets in the
// order they'll actually come up: the four Stage 0 stage tickets (watch, rebuild,
// build, teach-back), then interview tickets in plan order.
export function upcomingForSprint(pool: Ticket[], rotation: Partial<Record<Weekday, string>>): UpcomingItem[] {
  const stageOrder: StageSession[] = ['watch', 'rebuild', 'build', 'teachback']
  const stageTickets = stageOrder
    .map(session => pool.find(t => t.kind === 'stage' && t.session === session))
    .filter((t): t is Ticket => t !== undefined)
  const interviewTickets = pool.filter(t => t.track === 'interview').sort((a, b) => a.order - b.order)
  return [...stageTickets, ...interviewTickets].map(ticket => {
    const weekday = weekdayFor(ticket, rotation)
    const role = weekday ? rotation[weekday] : undefined
    const label = weekday && role ? `${weekday} · ${role}` : ticket.track === 'ai' ? 'AI' : 'Interview'
    return { ticket, weekday, label, firstLink: ticket.links[0] }
  })
}

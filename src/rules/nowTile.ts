import type { Link, PlanJson, Ticket } from '../data/types'
import { parseLocalDate, weekdayOf } from '../lib/dates'
import { scheduleOf } from '../content/schedule'
import { cardRole, dayTime, daySentence, dayVerb, linkShort, type DayTone } from './dayPlan'
import { minutesOf } from './brief'
import { partIndexOf } from './split'
import { effectiveLastSprint, planPosition, SPRINT_DAYS, TOTAL_SPRINTS, type PlanPosition } from './sprint'
import { todayView } from './today'

export interface NowLink { url: string; label: string; short: string }
export interface NowTileModel {
  phase: 'before' | 'active' | 'after'
  eyebrow: string
  time: string
  verb: string
  tone: DayTone
  sentence: string
  /** The lead ticket: target of the accent primary **Start ▸** and of Enter (spec D4, ruling Q1). */
  primaryId: string | null
  /** The lead's first http(s) link: the secondary control-bevel **Open · short ↗**, or null (no Open button). */
  link: NowLink | null
  /** Sprint the rest of Today reads: 1 before start, the active sprint, or the last sprint after. */
  sprint: number
  /** 0 before start (nothing elapsed), 1–14 while active, 14 after. */
  dayInSprint: number
}

type Active = Extract<PlanPosition, { phase: 'active' }>

/** Ruling 20 S5: a part as one item: "200 · Number of Islands — part 1 of 3 · 12 min". */
export function partLabel(part: Ticket, parent: Ticket | undefined): string {
  const n = partIndexOf(part)
  const of = parent?.children?.length
  const base = parent?.title ?? part.title.replace(/ · part \d+ of \d+$/, '')
  return n && of ? `${base} — part ${n} of ${of} · ${minutesOf(part)} min` : `${part.title} · ${minutesOf(part)} min`
}

const isWeb = (l: Link) => /^https?:\/\//i.test(l.url)

export function nowTileModel(i: { nowMs: number; startDate: string; plan: PlanJson; tickets: Ticket[] }): NowTileModel {
  const last = effectiveLastSprint(i.tickets)
  const pos = planPosition(i.nowMs, i.startDate, last)

  if (pos.phase === 'after') {
    const view = todayView(pos, i.plan.rotation, i.tickets, i.startDate)
    const unfinished = view.kind === 'after' ? view.unfinished : 0
    const tail = unfinished > 0 ? ` ${unfinished} ${unfinished === 1 ? 'ticket is' : 'tickets are'} still unfinished.` : ''
    return {
      phase: 'after', eyebrow: view.eyebrow, time: '', verb: 'Plan complete', tone: 'off',
      sentence: `All ${TOTAL_SPRINTS} sprints are behind you. The Board and your history stay here.${tail}`,
      primaryId: null, link: null, sprint: last, dayInSprint: SPRINT_DAYS,
    }
  }

  const before = pos.phase === 'before'
  const daysUntil = pos.phase === 'before' ? pos.daysUntil : 0
  const active: Active = pos.phase === 'active'
    ? pos
    : { phase: 'active', sprint: 1, dayInSprint: 1, weekday: weekdayOf(parseLocalDate(i.startDate)) }
  const view = todayView(active, i.plan.rotation, i.tickets, i.startDate)
  const role = view.kind === 'work' || view.kind === 'rest' || view.kind === 'clear' ? view.role : ''
  const picks = view.kind === 'work' ? view.tickets : []
  const lead = picks[0] ?? null
  const dv = dayVerb(role, active.weekday, lead)
  const focusAi = i.plan.sprints.find(s => s.sprint === active.sprint)?.focus_ai ?? ''
  const byId = new Map(i.tickets.map(t => [t.id, t]))
  const label = (part: Ticket) => partLabel(part, part.childOf ? byId.get(part.childOf) : undefined)
  const lonePart = lead?.childOf !== undefined && picks.length === 1 ? lead : null
  const web = lead?.links.find(isWeb)
  const schedule = scheduleOf(i.plan)
  const time = dayTime(active.weekday, schedule)
  // UAT r2 J3: the eyebrow describes the card shown: when the verb names the lead card (the role's card is done),
  // so does the eyebrow's role part ("… · AI · rebuild" under "Rebuild · 50 min", not the rotation's "AI · watch")
  const eyebrow = dv.byCard && lead && role && view.eyebrow.endsWith(` · ${role}`)
    ? `${view.eyebrow.slice(0, -role.length)}${cardRole(lead)}`
    : view.eyebrow
  return {
    phase: before ? 'before' : 'active',
    eyebrow: before ? `PLAN STARTS ${i.startDate} · ${eyebrow}` : eyebrow,
    time: before ? `in ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'} · ${time}` : time,
    // shell-today-board M12: with nothing to do (an empty sprint) the headline is the bare day verb, no minutes.
    // Ruling 22 D1: a split never changes the slot's block ("Code · 2 × 25 min" for 200's parts + 695: whatever fit
    // before still fits); only a lone part left in the slot carries its own minutes (ruling 20 S5: "Code · 11 min")
    verb: lonePart ? `${dv.verb.split(' · ')[0]} · ${minutesOf(lonePart)} min` : lead || dv.kind === 'rest' ? dv.verb : dv.verb.split(' · ')[0],
    tone: dv.tone,
    sentence: daySentence(dv.kind, picks, focusAi, schedule, label),
    primaryId: lead?.id ?? null,
    link: web ? { url: web.url, label: web.label, short: linkShort(web.label) } : null,
    sprint: active.sprint,
    dayInSprint: before ? 0 : active.dayInSprint,
  }
}

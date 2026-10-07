import { blockRange, SAMPLE_SCHEDULE } from '../content/schedule'
import type { PlanSchedule, Ticket } from '../data/types'
import type { Weekday } from '../lib/dates'
import { isRestRole } from './today'
import { typesAlong } from './ticketText'

export type DayKind = 'watch' | 'rebuild' | 'build' | 'teachback' | 'code' | 'design' | 'read' | 'interview' | 'rest' | 'other'
export type DayTone = 'ai' | 'interview' | 'off'
export interface DayVerb {
  kind: DayKind; verb: string; tone: DayTone
  /** the verb names the lead card, not the day's role (the role's card is done, or the sprint has none) */
  byCard?: boolean
}

/** UAT r2 J3: the role words for the card itself, as the rotation writes them ("AI · rebuild", "Interview · code"). */
export function cardRole(lead: Ticket): string {
  const track = lead.track === 'ai' ? 'AI' : 'Interview'
  if (lead.kind === 'stage') {
    const s = lead.session === 'build' ? 'build + break' : lead.session === 'teachback' ? 'teach-back' : lead.session ?? 'stage'
    return `${track} · ${s}`
  }
  if (lead.kind === 'problem') return `${track} · code`
  if (lead.kind === 'design') return `${track} · design`
  return track
}

/** Prototype dayPlan() time line per weekday: the schedule's evening block Mon–Thu (G6: plan data), fixed copy otherwise. */
export function dayTime(weekday: Weekday, schedule: PlanSchedule = SAMPLE_SCHEDULE): string {
  if (weekday === 'Fri') return '0 min'
  if (weekday === 'Sat') return '3 h + 30 min news'
  if (weekday === 'Sun') return '2 h + 30 min review'
  return blockRange(schedule)
}

const weekend = (d: Weekday) => d === 'Sat' || d === 'Sun'

/**
 * The NOW headline, derived from the rotation's role text (not the weekday index), so plan
 * edits and the legacy fixture both work. 'rebuild' is tested before 'build' (substring).
 * Tone follows the lead ticket's track; with no lead, the role's track.
 */
/** What the lead card itself is (UAT J3: the NOW tile names exactly the card Start opens), or null to use the role. */
function leadKind(lead: Ticket): DayKind | null {
  if (lead.kind === 'stage') {
    return lead.session === 'rebuild' ? 'rebuild' : lead.session === 'watch' ? 'watch' : lead.session === 'build' ? 'build' : lead.session === 'teachback' ? 'teachback' : null
  }
  if (lead.kind === 'design') return 'design'
  if (lead.kind === 'problem') return 'code'
  return null
}

export function dayVerb(role: string, weekday: Weekday, lead: Ticket | null): DayVerb {
  const byRole = roleVerb(role, weekday, lead)
  const k = lead ? leadKind(lead) : null
  if (!lead || !k || k === byRole.kind || byRole.kind === 'rest') return byRole
  // the card Start opens is not the role's kind (the role's card is done, or the sprint has none): name the card
  const tone: DayTone = lead.track === 'ai' ? 'ai' : 'interview'
  const verbs: Record<string, string> = {
    watch: 'Watch · 50 min', rebuild: 'Rebuild · 50 min', build: weekend(weekday) ? 'Build · 3 h' : 'Build · 50 min',
    teachback: 'Teach-back · 2 h', code: 'Code · 2 × 25 min', design: 'Design · 45 min',
  }
  return { kind: k, verb: verbs[k], tone, byCard: true }
}

function roleVerb(role: string, weekday: Weekday, lead: Ticket | null): DayVerb {
  const ai = /^ai\b/i.test(role)
  const tone = (fallback: DayTone): DayTone => (lead ? (lead.track === 'ai' ? 'ai' : 'interview') : fallback)
  const roleTone: DayTone = ai ? 'ai' : 'interview'
  if (isRestRole(role)) return { kind: 'rest', verb: 'Rest · off', tone: 'off' }
  if (ai && /rebuild/i.test(role)) return { kind: 'rebuild', verb: 'Rebuild · 50 min', tone: tone('ai') }
  if (ai && /watch/i.test(role)) return { kind: 'watch', verb: 'Watch · 50 min', tone: tone('ai') }
  if (ai && /build/i.test(role)) return { kind: 'build', verb: weekend(weekday) ? 'Build · 3 h' : 'Build · 50 min', tone: tone('ai') }
  if (/teach/i.test(role)) return { kind: 'teachback', verb: 'Teach-back · 2 h', tone: tone(roleTone) }
  if (/code/i.test(role)) return { kind: 'code', verb: 'Code · 2 × 25 min', tone: tone('interview') }
  if (/design/i.test(role)) {
    return lead?.kind === 'design'
      ? { kind: 'design', verb: 'Design · 45 min', tone: tone('interview') }
      : { kind: 'read', verb: 'Read · 50 min', tone: tone('interview') }
  }
  if (/interview/i.test(role)) {
    return { kind: 'interview', verb: weekend(weekday) ? 'Interview · 2 h' : 'Interview · 50 min', tone: tone('interview') }
  }
  return { kind: 'other', verb: 'Today', tone: tone(roleTone) }
}

/** Prototype linkShort: parentheses removed, cut at ':' or '·', over 22 chars → first 20 + '…'. */
export function linkShort(label: string): string {
  const l = label.replace(/\s*\(.*?\)/g, '').split(/[:·]/)[0].trim()
  return l.length > 22 ? `${l.slice(0, 20).trim()}…` : l
}

const name = (t: Ticket) => t.title.replace(' · ', ' ')

/** The leading run of picks that are parts of the lead's card (ruling 22 D1: its open parts, in its place). */
function leadRun(picks: Ticket[]): Ticket[] {
  const lead = picks[0]
  if (lead?.childOf === undefined) return lead ? [lead] : []
  const end = picks.findIndex(t => t.childOf !== lead.childOf)
  return end < 0 ? picks : picks.slice(0, end)
}

/**
 * Ruling 22 D1: a slot's items in order. A split card's parts stand in its place: the first is named in full
 * ("200 · Number of Islands — part 1 of 3 · 12 min", ruling 20 S5), the rest of its run by part ("part 2 of 3 · 12 min").
 * Without a part labeller, parts read like any card.
 */
export function slotItems(picks: Ticket[], part?: (t: Ticket) => string): string {
  const out: string[] = []
  picks.forEach((t, i) => {
    if (t.childOf === undefined || !part) { out.push(name(t)); return }
    const full = part(t)
    const cut = full.lastIndexOf(' — ')
    if (i > 0 && picks[i - 1].childOf === t.childOf && cut >= 0) out[out.length - 1] += `, ${full.slice(cut + 3)}`
    else out.push(full)
  })
  return out.join(' · ')
}

const COUNT = ['No', 'One', 'Two', 'Three', 'Four']
const count = (n: number) => COUNT[n] ?? String(n)

/** Prototype dayPlan() sentences, rewritten for forge capstone sessions (spec "Day-verb mapping"). */
export function daySentence(kind: DayKind, picks: Ticket[], focusAi: string, schedule: PlanSchedule = SAMPLE_SCHEDULE, parts?: (part: Ticket) => string): string {
  if (kind === 'rest') return schedule.restDay
  const lead = picks[0]
  if (!lead) return 'Nothing left for today in this sprint. Pick anything from the Board.'
  const subject = lead.kind === 'stage' && focusAi ? focusAi : lead.title
  // ruling 22 D1: a split card's open parts are its sessions in this slot; the sentence names them after the card
  const split = lead.childOf !== undefined && !!parts
  const run = leadRun(picks)
  const sessions = split ? ` · ${slotItems(run, parts)}` : ''
  const rest = picks.slice(run.length)
  switch (kind) {
    case 'watch': {
      const labels = lead.kind === 'stage' ? lead.links.map(l => l.label) : []
      // UAT J3: the same words as the card's own statement (stage 00's references are videos, not code)
      return `${typesAlong(lead) ? 'Watch and type along' : 'Watch'}: ${subject}${labels.length ? ` — ${labels.join(' · ')}` : ''}${sessions}`
    }
    case 'rebuild':
      return `Rebuild Monday's work from a blank editor, no video, no agent. ${subject}${sessions}`
    case 'build':
      return `Build + break: ${subject}${sessions}. The 30 min news slot comes first, timer on.`
    case 'teachback':
      return `Teach back ${subject}${sessions}: sketch it on paper or explain it in writing, then grade it against the rubric.${rest.length ? ` Then: ${slotItems(rest, parts)}.` : ''} Tick tasks, five lines in your notes.`
    case 'code': {
      const probs = picks.filter(t => t.kind === 'problem')
      if (probs.length === 0) return `Timed practice, no agent: ${split ? slotItems(picks, parts) : lead.title}`
      if (!parts || !probs.some(t => t.childOf !== undefined)) {
        const head = probs.length === 1 ? 'One timed problem, 25 min, no agent' : 'Two timed problems, 25 min each, no agent'
        return `${head}: ${probs.map(name).join(' · ')}`
      }
      // ruling 20 S5: a lone part is one timed session; ruling 22 D1: a split problem's parts stand in its place,
      // and two parts of one problem are never counted as two problems
      if (probs.length === 1) return `One timed session, no agent: ${parts(probs[0])}`
      const problems = new Set(probs.map(t => t.childOf ?? t.id)).size
      return `${count(problems)} timed ${problems === 1 ? 'problem' : 'problems'} in ${count(probs.length).toLowerCase()} sessions, no agent: ${slotItems(probs, parts)}`
    }
    case 'design':
      if (split) return run.length === 1 ? `One design session, recorded: ${slotItems(run, parts)}` : `One design in ${count(run.length).toLowerCase()} sessions, recorded: ${slotItems(run, parts)}`
      return `One design in 45 min, recorded: ${lead.title}`
    case 'read':
      return `Reading for the interview track: ${split ? slotItems(picks, parts) : lead.title}`
    case 'interview':
      return `${slotItems(picks, parts)}. Tick tasks, five lines in your notes.`
    default:
      return split ? slotItems(picks, parts) : subject
  }
}

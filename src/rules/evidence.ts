// Progress evidence (TRACKING "What ties the three together on Progress"; PLATFORM "honesty chart",
// "Redo hit rate"; integration spec §4). Pure: no React, no Dexie.
import type { DojoEvent, Session, Ticket } from '../data/types'
import type { ChartTone } from '../ui/charts/types'
import { sprintOf } from './sprint'
import { isPart, itemSessions } from './units'

export interface DsaEvidence { solved: number; help: number; gaveUp: number; redoPassed: number; redoTotal: number }
export interface RedoHitRate { passed: number; failed: number; refunded: number }

export const passRate = (p: number, t: number): string => `${p} / ${t}`

export function redoHitRate(events: readonly DojoEvent[]): RedoHitRate {
  let passed = 0
  let failed = 0
  let refunded = 0
  for (const e of events) {
    if (e.t === 'redo_pass') { passed++; refunded += e.refund }
    else if (e.t === 'redo_fail') failed++
  }
  return { passed, failed, refunded }
}

/**
 * Problems with a Do session, each counted once by its latest session; ticks without a session are not evidence.
 * Ruling 20 S4 (UAT r4 P1): a split problem counts once, as its parent, when all its parts are done (itemSessions).
 */
export function dsaEvidence(tickets: readonly Ticket[], sessions: readonly Session[], events: readonly DojoEvent[]): DsaEvidence {
  const problems = problemIds(tickets)
  const latest = latestSessions(problems, sessions, tickets)
  let solved = 0
  let help = 0
  let gaveUp = 0
  // cu-final row 6: a solved card the Board / Banks has since unticked is no longer solved: the live ticket state decides, as Banks does
  const doneIds = new Set(tickets.filter(t => t.status === 'done').map(t => t.id))
  for (const s of latest.values()) {
    if (s.outcome === 'solved') { if (doneIds.has(s.ticketId)) solved++ }
    else if (s.outcome === 'solved_help') { if (doneIds.has(s.ticketId)) help++ }
    else gaveUp++
  }
  // M4: redo_pass/redo_fail are emitted by the same closeLadderSession for any kind that runs
  // through the Do ladder (including kind 'design' redos, not just DSA problems) - keyed on the
  // ticket id. Restrict to DSA problem tickets so a design redo never inflates this rate; other
  // event kinds sharing that id are harmless since redoHitRate only counts the two redo types.
  const r = redoHitRate(events.filter(e => 'id' in e && problems.has(e.id)))
  return { solved, help, gaveUp, redoPassed: r.passed, redoTotal: r.passed + r.failed }
}

const problemIds = (tickets: readonly Ticket[]): Set<string> =>
  new Set(tickets.filter(t => t.kind === 'problem' && !t.archived && !isPart(t)).map(t => t.id))

/** Each problem's latest Do session that counts (a study session does not), parts folded into their parent (S4). */
function latestSessions(problems: ReadonlySet<string>, sessions: readonly Session[], tickets: readonly Ticket[]): Map<string, Session> {
  const latest = new Map<string, Session>()
  for (const s of itemSessions(sessions, tickets)) {
    if (!problems.has(s.ticketId) || s.outcome === 'studied') continue
    const cur = latest.get(s.ticketId)
    if (!cur || s.end > cur.end || (s.end === cur.end && s.start > cur.start)) latest.set(s.ticketId, s)
  }
  return latest
}

/**
 * UAT cu-3 P3-6: the plan problems that are done (the DSA tile and the Progress ring count them) without a Do session
 * behind them: ticked on the Board or the DSA tab. They stay out of the three stats above (integration I-12: a tick without
 * a Do session counts nowhere), so this is the number that makes the tile and the stats add up, and Evidence says so.
 */
export function dsaTickedWithoutAttempt(tickets: readonly Ticket[], sessions: readonly Session[]): number {
  const latest = latestSessions(problemIds(tickets), sessions, tickets)
  return tickets.filter(t => t.kind === 'problem' && t.origin === 'plan' && !t.archived && !isPart(t) && t.status === 'done' && !latest.has(t.id)).length
}

export const LADDER_SERIES = [
  { key: 'attempt', label: 'Attempt only', tone: 'ok' },
  { key: 'hint', label: 'Hint', tone: 'rival' },
  { key: 'picture', label: 'Picture', tone: 'warn' },
  { key: 'video', label: 'Video', tone: 'boss' },
  { key: 'solution', label: 'Solution', tone: 'danger' },
] as const satisfies readonly { key: string; label: string; tone: ChartTone }[]

export function deepestRung(s: Session): 1 | 2 | 3 | 4 | 5 {
  return (s.rungs && s.rungs.length ? Math.max(...s.rungs) : 1) as 1 | 2 | 3 | 4 | 5
}

export interface LadderUsageRow { sprint: number; counts: [number, number, number, number, number] }

/** PLATFORM: sessions per sprint by deepest rung reached, Attempt only (green) → Solution (red). */
export function helpLadderUsage(sessions: readonly Session[], startDate: string): LadderUsageRow[] {
  const by = new Map<number, [number, number, number, number, number]>()
  for (const s of sessions) {
    if (s.outcome === 'studied') continue // a study session opens no rung: it is not an attempt
    const sp = sprintOf(s.start, startDate)
    if (sp < 1) continue
    const row = by.get(sp) ?? [0, 0, 0, 0, 0]
    row[deepestRung(s) - 1]++
    by.set(sp, row)
  }
  if (by.size === 0) return []
  const last = Math.max(...by.keys())
  return Array.from({ length: last }, (_, i) => ({ sprint: i + 1, counts: by.get(i + 1) ?? [0, 0, 0, 0, 0] }))
}

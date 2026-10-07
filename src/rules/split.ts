// Splitting a big item into sessions (briefs spec §1, BR-08). Pure.
import type { Ticket } from '../data/types'
import { minutesOf, needsCheck } from './brief'
import { ticketBaseXp } from './xp'

export const SPLIT_MIN_PARTS = 2
/** Ruling 20 S2: never more than 8 parts, and never a part under 10 min. */
export const SPLIT_PARTS_CAP = 8
export const SPLIT_MIN_PART_MINUTES = 10
/** Ruling 20 S2: a card under 20 min doesn't offer Split (two parts of 10 min is the smallest split). */
export const SPLIT_MIN_MINUTES = SPLIT_MIN_PARTS * SPLIT_MIN_PART_MINUTES
/** Ruling 20 S2: the "about 45–90 min each" advice shows only on a card of at least 90 min. */
export const SPLIT_ADVICE_MINUTES = 90

/** Parts: min 2, max min(8, ⌊minutes/10⌋), so every part is at least 10 min (ruling 20 S2). */
export function splitMaxParts(t: Pick<Ticket, 'brief' | 'estMin'>): number {
  return Math.max(SPLIT_MIN_PARTS, Math.min(SPLIT_PARTS_CAP, Math.floor(minutesOf(t) / SPLIT_MIN_PART_MINUTES)))
}

export const partsRangeMessage = (t: Pick<Ticket, 'brief' | 'estMin'>): string => `Split into ${SPLIT_MIN_PARTS} to ${splitMaxParts(t)} parts`

export const inPartsRange = (t: Pick<Ticket, 'brief' | 'estMin'>, parts: number): boolean =>
  Number.isInteger(parts) && parts >= SPLIT_MIN_PARTS && parts <= splitMaxParts(t)

/**
 * Ruling 20 S2: whether the Do screen offers "Split into sessions": a card with a brief of at least 20 min that is
 * neither a part nor already split. Any other reason it can't be split is said inside the dialog (ruling 10 Q22).
 */
export function offersSplit(t: Pick<Ticket, 'brief' | 'estMin' | 'children' | 'childOf'>): boolean {
  return !!t.brief && !t.childOf && !(t.children?.length) && minutesOf(t) >= SPLIT_MIN_MINUTES
}

/** Ruling 20 S1: minutes shared by largest remainder, so the parts sum exactly to the card (35 → 12, 12, 11). */
export function splitMinutes(total: number, parts: number): number[] {
  const whole = Math.max(0, Math.round(total))
  const each = Math.floor(whole / parts)
  const rest = whole - each * parts
  return Array.from({ length: parts }, (_, i) => each + (i < rest ? 1 : 0))
}

/**
 * The parts' minutes: always the even largest-remainder share of the card, so parts differ by at most 1 min
 * (ruling 20 S1: 110 → 55, 55). A brief's proposed per-step minutes are not used (UAT r5: they gave 50 + 60).
 */
export function partMinutes(t: Pick<Ticket, 'brief' | 'estMin'>, parts: number): number[] {
  return splitMinutes(minutesOf(t), parts)
}

/** "12, 12 and 11 min"; "18 and 17 min". */
export function minutesList(ms: readonly number[]): string {
  if (ms.length <= 1) return `${ms[0] ?? 0} min`
  return `${ms.slice(0, -1).join(', ')} and ${ms[ms.length - 1]} min`
}

/** Ruling 20 S2: the dialog body states the result, and follows Parts as it changes. */
export function splitBodyText(minutes: readonly number[]): string {
  return `Cut this card into ${minutes.length} sessions (${minutesList(minutes)}). Each session is its own card in the same sprint; this card is done when all of them are.`
}

/** Ruling 20 S2: the suggested number of parts for a card of at least 90 min (the brief's proposal, else ~60 min each). */
export function suggestedParts(t: Pick<Ticket, 'brief' | 'estMin'>): number | null {
  if (minutesOf(t) < SPLIT_ADVICE_MINUTES) return null
  const proposed = t.brief?.splitSuggestion?.length ?? 0
  const n = proposed >= SPLIT_MIN_PARTS ? proposed : Math.round(minutesOf(t) / 60)
  return Math.max(SPLIT_MIN_PARTS, Math.min(splitMaxParts(t), n))
}

export const suggestedText = (n: number): string => `Suggested: ${n} parts (about 45–90 min each)`

export type SplitCheck = { ok: true } | { ok: false; message: string }

export function canSplit(t: Ticket, parts: number): SplitCheck {
  if (t.archived) return { ok: false, message: 'Ticket is archived' }
  if (t.childOf) return { ok: false, message: 'A session cannot be split again' }
  if (t.children?.length) return { ok: false, message: 'Already split into sessions' }
  if (t.status === 'done') return { ok: false, message: 'A finished card cannot be split' }
  if (t.deepestRung) return { ok: false, message: 'A card you already took help on cannot be split' }
  if (minutesOf(t) < SPLIT_MIN_MINUTES) return { ok: false, message: `A card under ${SPLIT_MIN_MINUTES} min is not split` }
  if (!inPartsRange(t, parts)) return { ok: false, message: partsRangeMessage(t) }
  return { ok: true }
}

export const childId = (parentId: string, i: number): string => `${parentId}~${i + 1}`

/** A part's number, 1-based, from its id ("p200~2" → 2); null for anything else. */
export function partIndexOf(t: Pick<Ticket, 'id' | 'childOf'>): number | null {
  if (!t.childOf || !t.id.startsWith(`${t.childOf}~`)) return null
  const n = Number(t.id.slice(t.childOf.length + 1))
  return Number.isInteger(n) && n >= 1 ? n : null
}

export interface SplitResult { parent: Ticket; children: Ticket[] }

/**
 * The parent becomes a container (`children`), the sessions stay in its sprint with `origin` and
 * `childOf` set to the parent's id. Their minutes add up exactly to the parent's (ruling 20 S1). `titles` may
 * carry the model's proposed session names; missing ones read "<title> · part i of n". Ruling 20 S3: a part
 * inherits what describes the work (links, difficulty, track, approaches, pattern, skill); the brief stays on the
 * parent and the part's Do screen shows it.
 */
export function splitTicket(parent: Ticket, parts: number, titles: readonly string[] = []): SplitResult {
  const mins = partMinutes(parent, parts)
  const base = ticketBaseXp(parent)
  const children = Array.from({ length: parts }, (_, i): Ticket => ({
    id: childId(parent.id, i),
    origin: parent.id,
    childOf: parent.id,
    track: parent.track,
    kind: parent.kind,
    title: titles[i]?.trim() || `${parent.title} · part ${i + 1} of ${parts}`,
    ...(parent.text ? { text: parent.text } : {}),
    links: parent.links.map(l => ({ ...l })),
    ...(parent.skill ? { skill: parent.skill } : {}),
    ...(parent.pattern ? { pattern: parent.pattern } : {}),
    ...(parent.difficulty ? { difficulty: parent.difficulty } : {}),
    ...(parent.rating !== undefined ? { rating: parent.rating } : {}),
    ...(parent.approaches ? { approaches: parent.approaches.map(a => ({ ...a })) } : {}),
    ...(parent.stage !== undefined ? { stage: parent.stage } : {}),
    ...(parent.session ? { session: parent.session } : {}),
    estMin: mins[i],
    xpBase: Math.floor(base / parts) + (i < base % parts ? 1 : 0),
    plannedSprint: parent.sprint,
    sprint: parent.sprint,
    status: 'todo',
    slidFrom: [],
    xp: 0,
    archived: false,
    // between the parent and the next plan card, in order
    order: parent.order + (i + 1) / (parts + 1),
  }))
  return { parent: { ...parent, children: children.map(c => c.id) }, children }
}

/** A container is done exactly when every live child is done. Returns the parent's next state, or null when nothing changes. */
export function containerState(parent: Ticket, children: Ticket[], now: number): Ticket | null {
  const live = children.filter(c => !c.archived)
  // ruling 10 Q22: a container whose own brief needs a check is finished only once that check passed, too
  const owed = needsCheck({ ...parent, status: 'todo' }) && parent.checkPassedAt === undefined
  const allDone = live.length > 0 && live.every(c => c.status === 'done') && !owed
  if (allDone && parent.status !== 'done') return { ...parent, status: 'done', doneAt: now, doneAtApprox: false }
  if (!allDone && parent.status === 'done') {
    const { doneAt: _a, doneAtApprox: _b, ...rest } = parent
    return { ...rest, status: 'todo' }
  }
  return null
}

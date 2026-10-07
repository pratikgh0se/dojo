import type { Ticket } from '../data/types'
import { minutesOf } from './brief'
import { TOTAL_SPRINTS } from './sprint'

export const DOING_CAP = 3

export type Column = 'slid' | 'todo' | 'doing' | 'done'
export const COLUMNS: Column[] = ['slid', 'todo', 'doing', 'done']
export const COLUMN_LABELS: Record<Column, string> = { slid: 'Slid in', todo: 'Todo', doing: 'Doing', done: 'Done' }

export type MoveReason = 'missing' | 'same' | 'slid_column' | 'doing_full' | 'container' | 'check_required'
export type MoveCheck = { ok: true } | { ok: false; reason: MoveReason }

export const MOVE_MESSAGES: Record<MoveReason, string> = {
  missing: 'Ticket not found',
  same: '',
  slid_column: 'Slid in fills itself: slide a ticket from an earlier sprint',
  doing_full: `Doing is full (${DOING_CAP}/${DOING_CAP}): finish or move one first`,
  check_required: 'Check your understanding first',
  container: 'This card was split: it is done when all its sessions are',
}

const live = (t: Ticket) => !t.archived

export function columnOf(t: Ticket): Column {
  if (t.status === 'done') return 'done'
  if (t.status === 'doing') return 'doing'
  return t.slidFrom.length > 0 ? 'slid' : 'todo'
}

export function sprintColumns(tickets: Ticket[], sprint: number): Record<Column, Ticket[]> {
  const out: Record<Column, Ticket[]> = { slid: [], todo: [], doing: [], done: [] }
  tickets
    .filter(t => live(t) && t.sprint === sprint)
    .sort((a, b) => a.order - b.order)
    .forEach(t => out[columnOf(t)].push(t))
  return out
}

/**
 * Ruling 20 S4: the Board's columns, with a split card shown as an uncounted group line next to its parts: in the
 * column of its first open part (the Done column once every part is done), placed by order just above them.
 */
export function boardColumns(tickets: Ticket[], sprint: number): Record<Column, Ticket[]> {
  const out = sprintColumns(tickets, sprint)
  const byId = new Map(tickets.map(t => [t.id, t]))
  for (const c of COLUMNS) {
    for (const box of out[c].filter(t => (t.children?.length ?? 0) > 0)) {
      const parts = (box.children ?? []).map(id => byId.get(id)).filter((p): p is Ticket => !!p && live(p) && p.sprint === sprint)
      const firstOpen = parts.filter(p => p.status !== 'done').sort((a, b) => a.order - b.order)[0]
      const home = firstOpen ? columnOf(firstOpen) : parts.length ? 'done' : c
      if (home === c) continue
      out[c] = out[c].filter(t => t.id !== box.id)
      out[home] = [...out[home], box].sort((a, b) => a.order - b.order)
    }
  }
  return out
}

/** The cards a column counts: everything listed but a split card's group line (ruling 20 S4). */
export const countedCards = (list: readonly Ticket[]): Ticket[] => list.filter(t => !(t.children?.length))

/**
 * What a column header counts (ruling 20 S4, UAT cu-3 P3-5). Slid in, Todo and Doing count the cards they list and
 * count: a part is a card you work, so it counts as one (its minutes are time), and a split card's group line is not
 * one. Done is the same (UAT cu-r1b F-B2): the header equals the cards listed under it, a done part included. Week's
 * "n done" and Progress's n/total count the problem once.
 */
/** "1 card" / "2 cards": the count words the Board's column tooltips use. */
export const cardsText = (n: number): string => `${n} ${n === 1 ? 'card' : 'cards'}`

export function columnCount(_c: Column, list: readonly Ticket[]): number {
  return countedCards(list).length
}

/** "200 · Number of Islands · split · 1 of 3 done" (ruling 20 S4). */
export function groupLineText(box: Ticket, tickets: readonly Ticket[]): string {
  const ids = new Set(box.children ?? [])
  const parts = tickets.filter(t => ids.has(t.id) && live(t))
  return `${box.title} · split · ${parts.filter(p => p.status === 'done').length} of ${parts.length} done`
}

/**
 * The Doing cards of one sprint: the limit is per sprint (ruling 25 R2, UAT cu-3p P2-2), so only the column on screen
 * counts, never a Doing card of another sprint. Without `sprint` it counts every sprint.
 */
export function doingCount(tickets: Ticket[], sprint?: number): number {
  // a split card's group line is no card (ruling 20 S4): only its parts, listed in their own columns, count (UAT cu-r1b F-B4)
  return tickets.filter(t => live(t) && t.status === 'doing' && !t.children?.length && (sprint === undefined || t.sprint === sprint)).length
}

export function canMove(tickets: Ticket[], id: string, to: Column): MoveCheck {
  const t = tickets.find(x => x.id === id)
  if (!t || t.archived) return { ok: false, reason: 'missing' }
  // Ruling 25 R5: a drop on Slid in refuses a card from another column (it fills itself), but a card already in it is only
  // being reordered there: nothing happens and nothing is said, as in the other columns.
  if (to === 'slid') return { ok: false, reason: columnOf(t) === 'slid' ? 'same' : 'slid_column' }
  if (t.status === to) return { ok: false, reason: 'same' }
  if (t.children?.length && (to === 'done' || to === 'doing')) return { ok: false, reason: 'container' }
  if (to === 'doing' && doingCount(tickets, t.sprint) >= DOING_CAP) return { ok: false, reason: 'doing_full' }
  return { ok: true }
}

export function stepColumn(t: Ticket, dir: 1 | -1): Column {
  const flow: Column[] = ['todo', 'doing', 'done']
  const cur = t.status === 'doing' ? 1 : t.status === 'done' ? 2 : 0
  return flow[Math.max(0, Math.min(2, cur + dir))]
}

export function debtBar(tickets: Ticket[], sprint: number): { own: number; slidIn: number; avg: number } {
  const inSprint = tickets.filter(t => live(t) && t.origin === 'plan' && t.sprint === sprint)
  const planCount = tickets.filter(t => live(t) && t.origin === 'plan').length
  return {
    own: inSprint.filter(t => t.slidFrom.length === 0).length,
    slidIn: inSprint.filter(t => t.slidFrom.length > 0).length,
    avg: Math.round(planCount / TOTAL_SPRINTS),
  }
}

export function stripLength(tickets: Ticket[]): number {
  return tickets.filter(live).reduce((m, t) => Math.max(m, t.sprint), TOTAL_SPRINTS)
}

/** A source chip's text: the name before ':' or '·', without parentheses. Never cut here (UAT r3 J7: "Tech Interview
 * Handboo"): the chip's CSS ellipsises a name too long for its row, and its `title` holds the whole label. */
export function shortSource(label: string): string {
  return label.split(/[:·]/)[0].replace(/\([^)]*\)/g, '').trim()
}

export function slidFromSuffix(t: Ticket): string {
  return t.slidFrom.length ? ` · from S${t.slidFrom[t.slidFrom.length - 1]}` : ''
}

export function rowMeta(t: Ticket): string {
  return `S${t.sprint}${slidFromSuffix(t)}`
}

export function liveTicketMap(tickets: Ticket[]): Map<string, Ticket> {
  return new Map(tickets.filter(live).map(t => [t.id, t]))
}

export function cardMeta(t: Ticket): string {
  return `S${t.sprint} · ${minutesOf(t)} min${slidFromSuffix(t)}`
}

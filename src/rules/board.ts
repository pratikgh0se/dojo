import type { Ticket } from '../data/types'

/** The statuses a move can set. `slid` survives only as a refused target (retired Board). */
export type Column = 'slid' | 'todo' | 'doing' | 'blocked' | 'help' | 'done'

export type MoveReason = 'missing' | 'same' | 'slid_column' | 'check_required'
export type MoveCheck = { ok: true } | { ok: false; reason: MoveReason }

export const MOVE_MESSAGES: Record<MoveReason, string> = {
  missing: 'Ticket not found',
  same: '',
  slid_column: 'Slid in fills itself: slide a ticket from an earlier sprint',
  check_required: 'Check your understanding first',
}

const live = (t: Ticket) => !t.archived

export function columnOf(t: Ticket): Column {
  if (t.status === 'done') return 'done'
  if (t.status === 'doing') return 'doing'
  if (t.status === 'blocked') return 'blocked'
  if (t.status === 'help') return 'help'
  return t.slidFrom.length > 0 ? 'slid' : 'todo'
}

export function canMove(tickets: Ticket[], id: string, to: Column): MoveCheck {
  const t = tickets.find(x => x.id === id)
  if (!t || t.archived) return { ok: false, reason: 'missing' }
  // Ruling 25 R5: a drop on Slid in refuses a card from another column (it fills itself), but a card already in it is only
  // being reordered there: nothing happens and nothing is said, as in the other columns.
  if (to === 'slid') return { ok: false, reason: columnOf(t) === 'slid' ? 'same' : 'slid_column' }
  if (t.status === to) return { ok: false, reason: 'same' }
  return { ok: true }
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

import type { Difficulty, Kind, Ticket } from '../data/types'

export function baseXp(kind: Kind, difficulty?: Difficulty): number {
  switch (kind) {
    case 'task':
    case 'watch':
    case 'read': return 10
    case 'problem': return difficulty === 'E' ? 5 : difficulty === 'H' ? 15 : 10
    case 'design': return 20
    case 'stage': return 10
    default: return 0
  }
}

export function levelOf(xp: number): number {
  return Math.floor(xp / 10)
}

export function totalXp(tickets: Ticket[]): number {
  return tickets.reduce((a, t) => a + (t.xp || 0), 0)
}

export function possibleXp(tickets: Ticket[]): number {
  return tickets
    .filter(t => t.origin === 'plan' && !t.archived)
    .reduce((a, t) => a + baseXp(t.kind, t.difficulty), 0)
}

/** DATA "XP": Codeforces base XP is round(rating/100) − 7 (1200 → 5, 1600 → 9), at least 1. */
export const CF_XP_OFFSET = 7

export function cfXp(rating: number): number {
  return Math.max(1, Math.round(rating / 100) - CF_XP_OFFSET)
}

/** Base XP for a ticket: the Codeforces rating rule when it has a rating, else baseXp. */
export function ticketBaseXp(t: Ticket): number {
  if (t.xpBase !== undefined) return t.xpBase
  return t.rating !== undefined ? cfXp(t.rating) : baseXp(t.kind, t.difficulty)
}

/** XP earned on plan tickets only: drives the form, never LV (DATA "bank grinding raises LV but not form"). */
export function planXp(tickets: Ticket[]): number {
  return tickets.filter(t => t.origin === 'plan' || t.childOf !== undefined).reduce((a, t) => a + (t.xp || 0), 0)
}

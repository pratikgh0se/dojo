import type { Ticket } from '../data/types'
import { BANK_TABS, type BankTabId } from '../content/banks/meta'
import type { BankEntry } from './banks'
import { EST_MIN } from './planTickets'
import { baseXp, cfXp } from './xp'

/**
 * C-BANKS §2: a known Codeforces item ticked from Mine must earn the same XP as ticking
 * it in Codeforces, even though its Mine row stores the E/M/H bucket, not the rating —
 * `rating` (carried onto the Mine row at add time) takes over from the bucket when set.
 */
export function bankItemXp(e: Pick<BankEntry, 'kind' | 'difficulty' | 'rating'>): number {
  if (e.kind === 'design') return baseXp('design')
  if (typeof e.difficulty === 'number') return cfXp(e.difficulty)
  if (e.rating !== undefined) return cfXp(e.rating)
  return baseXp('problem', e.difficulty ?? 'M')
}

export function originFor(bank: BankTabId): Ticket['origin'] {
  if (bank === 'plan') return 'plan'
  if (bank === 'mine') return 'mine'
  return `bank:${bank}`
}

/**
 * True only for a real bank-origin ticket (`bank:*` or `mine`). Replaces the old
 * `origin !== 'plan'` checks in reconcile.ts and boardActions.ts, which wrongly treated
 * any unknown or missing origin as a bank ticket; an unknown/missing origin now behaves
 * like `'plan'` instead.
 */
export function isBankOrigin(origin: Ticket['origin'] | string | undefined | null): boolean {
  return origin === 'mine' || (typeof origin === 'string' && origin.startsWith('bank:'))
}

/** Board chip text for a bank-origin ticket (C-BANKS §2: the bank's tab label). */
export function originLabel(origin: Ticket['origin']): string | null {
  if (origin === 'plan') return null
  const id = origin === 'mine' ? 'mine' : origin.slice('bank:'.length)
  return BANK_TABS.find(t => t.id === id)?.label ?? null
}

const HOSTS: Array<[RegExp, string]> = [
  [/leetcode\.com/, 'LeetCode'],
  [/codeforces\.com/, 'Codeforces'],
  [/hellointerview\.com/, 'Hello Interview'],
  [/geeksforgeeks\.org/, 'GFG'],
  [/codingninjas\.com|naukri\.com/, 'Coding Ninjas'],
  [/takeuforward\.org/, 'takeUforward'],
]

export function linkLabel(url: string): string {
  return HOSTS.find(([re]) => re.test(url))?.[1] ?? 'Link'
}

/** C-BANKS §2: the first tick of a bank-only item creates a done ticket in the current sprint. */
export function bankTicket(e: BankEntry, bank: BankTabId, nowMs: number, sprint: number): Ticket {
  const t: Ticket = {
    id: e.id,
    origin: originFor(bank),
    track: 'interview',
    kind: e.kind,
    title: e.name,
    links: e.url ? [{ label: linkLabel(e.url), url: e.url }] : [],
    estMin: EST_MIN[e.kind],
    plannedSprint: sprint,
    sprint,
    status: 'done',
    slidFrom: [],
    doneAt: nowMs,
    doneAtApprox: false,
    xp: bankItemXp(e),
    archived: false,
    order: nowMs,
  }
  if (e.pattern) t.pattern = e.pattern
  if (typeof e.difficulty === 'string') t.difficulty = e.difficulty
  if (typeof e.difficulty === 'number') t.rating = e.difficulty
  else if (e.rating !== undefined) t.rating = e.rating
  return t
}

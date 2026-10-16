// The hint ladder's state (R2 W2): which rung is next, and whether the lab was built "with help". Pure.
// `labs.hints` keeps {ticketId, rung, at} once per (ticket, rung); the hint text itself is fetched from the server each time.
import type { LabHintUse } from '../data/types'

export type Rung = 1 | 2 | 3

/** The rung shown for a ticket, in order: rung n opens after n-1 was shown. null once all three were shown. Tolerates duplicates. */
export function nextRung(hints: readonly LabHintUse[], ticketId: string): Rung | null {
  const shown = new Set(hints.filter(h => h.ticketId === ticketId).map(h => h.rung))
  return ([1, 2, 3] as const).find(r => !shown.has(r)) ?? null
}

/** Whether `rung` was already shown for the ticket (showing it again stores nothing). */
export const rungShown = (hints: readonly LabHintUse[], ticketId: string, rung: Rung): boolean => hints.some(h => h.ticketId === ticketId && h.rung === rung)

/** "With help": the lab's hints contain a rung 3, on any ticket. Hints cost no XP and carry no penalty. */
export const withHelp = (hints: readonly LabHintUse[]): boolean => hints.some(h => h.rung === 3)

/** A hint may be opened when it was shown already (re-showing), or when it is the next rung for the ticket. */
export const rungAllowed = (hints: readonly LabHintUse[], ticketId: string, rung: Rung): boolean =>
  rungShown(hints, ticketId, rung) || nextRung(hints, ticketId) === rung

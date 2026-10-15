import type { Settings, Ticket } from '../data/types'
import type { Plan } from '../study/runner'
import { sessionMinutesOf } from './prefs'

/** A fifth of the focus block, as Pomodoro does it: 25 gives 5, 50 gives 10. */
export const breakFor = (focusMin: number): number => Math.min(60, Math.max(1, Math.round(focusMin / 5)))

/** Start on a ticket: one card, no goal prompt, the remembered length, one block and no break. */
export function planFor(ticket: Pick<Ticket, 'id'>, settings: Pick<Settings, 'sessionMinutes'> | undefined, chime: boolean): Plan {
  const focusMin = sessionMinutesOf(settings)
  return { goal: '', focusMin, breakMin: breakFor(focusMin), cardIds: [ticket.id], chime, single: true }
}

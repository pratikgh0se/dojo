import { localDayKey } from '../lib/dates'
import { checkPulseText, pulseId, weekTicket, weekTicketId } from '../rules/ritual'
import { ritualOpen, ritualTicket, ritualTicketId, type RitualEntry } from '../rules/ritualPeriod'
import type { DojoDB } from './db'
import type { Pulse } from './types'

export type PulseResult = { ok: true } | { ok: false; message: string }

/**
 * Log today's AI pulse: one row per local day. A second save on the same day (Edit) overwrites that row: the new text and the
 * time of this save (`at` is when it was last saved). Writes only the `pulses` table: no XP, no event, no ticket.
 */
export async function logPulse(d: DojoDB, raw: string, nowMs: number): Promise<PulseResult> {
  const c = checkPulseText(raw)
  if (!c.ok) return c
  const day = localDayKey(nowMs)
  return d.transaction('rw', d.pulses, async (): Promise<PulseResult> => {
    const row: Pulse = { id: pulseId(day), day, at: nowMs, text: c.text }
    await d.pulses.put(row)
    return { ok: true }
  })
}

/**
 * Open the week's "Try a model" ticket, creating it if this ISO week has none yet. Idempotent: an existing ticket (started,
 * done or archived) is returned untouched. Called only from the Open click, never on page load.
 */
export async function openWeekTicket(d: DojoDB, nowMs: number, o: { minutes: number; dueWeekday: number }): Promise<string> {
  const id = weekTicketId(nowMs)
  await d.transaction('rw', d.tickets, async () => {
    if (!(await d.tickets.get(id))) await d.tickets.put(weekTicket(nowMs, o))
  })
  return id
}

/**
 * W5: open any windowed ritual (weekly review, monthly swap drill): create the period's ticket if it has none, return its id.
 * Idempotent like `openWeekTicket`; null when the entry's window is not open. Called only from an Open click, never on page load.
 */
export async function openRitualTicket(d: DojoDB, entry: RitualEntry, nowMs: number): Promise<string | null> {
  const period = ritualOpen(entry, nowMs)
  if (!period) return null
  const id = ritualTicketId(entry.id, period.key)
  await d.transaction('rw', d.tickets, async () => {
    if (!(await d.tickets.get(id))) await d.tickets.put(ritualTicket(entry, period, nowMs))
  })
  return id
}

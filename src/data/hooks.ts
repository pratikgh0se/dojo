import { useLiveQuery } from 'dexie-react-hooks'
import { useDb } from './dbContext'
import { getSettings, type SettingsRow } from './db'
import type { AtlasRun, BankExtraRow, BankGradeRow, BankItem, CheckAttemptRow, JournalRow, Pulse, Redo, RungUse, Session, StoredEvent, Ticket } from './types'

export function useTickets(): Ticket[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.tickets.toArray(), [d])
}

export function useSessions(): Session[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.sessions.toArray(), [d])
}

export function useEvents(): StoredEvent[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.events.toArray(), [d])
}

/** Only the `focus` events since `sinceMs` (Today needs a week of them, not the whole event log). */
export function useFocusEvents(sinceMs: number): StoredEvent[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.events.filter(e => e.t === 'focus' && e.at >= sinceMs).toArray(), [d, sinceMs])
}

export function useSettings(): SettingsRow | undefined {
  const d = useDb()
  return useLiveQuery(() => getSettings(d), [d])
}

export function useTicket(id: string): Ticket | null | undefined {
  const d = useDb()
  return useLiveQuery(async () => (await d.tickets.get(id)) ?? null, [d, id])
}

/** The AI pulse logged on a local day (`YYYY-MM-DD`): the row, null when none, undefined while loading. */
export function usePulse(day: string): Pulse | null | undefined {
  const d = useDb()
  return useLiveQuery(async () => (await d.pulses.get(`pulse-${day}`)) ?? null, [d, day])
}

/** R1 W2: every journal row (one per local day; a few hundred at most), newest day last; undefined while loading. */
export function useJournalRows(): JournalRow[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.journal.orderBy('day').toArray(), [d])
}

/** The journal row of a local day (`YYYY-MM-DD`): the row, null when none, undefined while loading. */
export function useJournalRow(day: string): JournalRow | null | undefined {
  const d = useDb()
  return useLiveQuery(async () => (await d.journal.get(`journal-${day}`)) ?? null, [d, day])
}

/** R1 W6: every graded question, and every AI-made one (undefined while loading). */
export function useBankGrades(): BankGradeRow[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.bankGrades.toArray(), [d])
}
export function useBankExtra(): BankExtraRow[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.bankExtra.toArray(), [d])
}

export function useAtlasRuns(): AtlasRun[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.atlasRuns.toArray(), [d])
}

export function useRedos(): Redo[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.redos.toArray(), [d])
}

export interface DoQuery { ticket: Ticket | null; redo: Redo | null; uses: RungUse[] }

// One atomic query over tickets + redos + rungUses, instead of three separate useLiveQuery
// hooks: Dexie's liveQuery re-runs the whole querier as a single unit whenever any table it
// touched changes, so ticket.ai and the rung-use rows written in the SAME transaction (e.g.
// recordRung) always arrive together in one render. Three independent hooks each re-run their
// own querier on the same underlying change event, but nothing guarantees their two resulting
// re-renders land in the same React commit — under load they can land a render apart, which
// showed up as a real, reproducible flake (content.solution briefly null right after the rung
// that unlocked it was recorded).
export function useDoQuery(ticketId: string): DoQuery | undefined {
  const d = useDb()
  return useLiveQuery(async (): Promise<DoQuery> => {
    const ticket = (await d.tickets.get(ticketId)) ?? null
    const [redos, uses] = await Promise.all([
      d.redos.where('ticketId').equals(ticketId).toArray(),
      d.rungUses.where('ticketId').equals(ticketId).toArray(),
    ])
    return { ticket, redo: redos.find(r => r.closedAt === undefined) ?? null, uses }
  }, [d, ticketId])
}

export function useBankItems(): BankItem[] | undefined {
  const d = useDb()
  return useLiveQuery(() => d.bankItems.toArray(), [d])
}

/** A ticket's learning-check attempts, oldest first (briefs Addendum 1 Q6). */
export function useCheckAttempts(ticketId: string): CheckAttemptRow[] | undefined {
  const d = useDb()
  return useLiveQuery(async () => (await d.checkAttempts.where('ticketId').equals(ticketId).toArray()).sort((a, b) => a.at - b.at), [d, ticketId])
}

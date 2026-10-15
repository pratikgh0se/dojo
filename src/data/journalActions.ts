import { localDayKey } from '../lib/dates'
import { canSave, hardRedo, journalId, rowFromForm, type JournalForm } from '../rules/journal'
import type { DojoDB } from './db'
import type { JournalRow } from './types'

/**
 * Save the entry for a day (JOURNAL-05, JOURNAL-12): one row per local day, replaced whole by every save. Writes only `journal`: no
 * XP, no event, no ticket, no redo, no pulse. A blank entry and a future day write nothing. Called only from the Save click.
 */
export async function saveJournal(d: DojoDB, form: JournalForm, day: string, listedIds: readonly string[], nowMs: number): Promise<JournalRow | null> {
  if (day > localDayKey(nowMs) || !canSave(form, listedIds)) return null
  const row = rowFromForm(form, day, listedIds, nowMs)
  await d.journal.put({ ...row, id: journalId(day) })
  return row
}

export type AddHardResult = 'added' | 'exists' | 'gone'

/**
 * "Add to Review" (JOURNAL-20/21/22): one `journal_hard` redo on the ticket, due on the clock day. A ticket that already has an
 * open one gets nothing new, so a double click or a second tab writes it once. Writes only `redos`.
 */
export async function addHardToReview(d: DojoDB, ticketId: string, nowMs: number): Promise<AddHardResult> {
  return d.transaction('rw', d.tickets, d.redos, async (): Promise<AddHardResult> => {
    const ticket = await d.tickets.get(ticketId)
    if (!ticket || ticket.archived) return 'gone'
    const open = (await d.redos.where('ticketId').equals(ticketId).toArray()).some(r => r.source === 'journal_hard' && r.closedAt === undefined)
    if (open) return 'exists'
    await d.redos.put(hardRedo(ticket, localDayKey(nowMs), nowMs))
    return 'added'
  })
}

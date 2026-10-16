import { localDayKey } from '../lib/dates'
import { canSave, hardRedo, JOURNAL_LINE_MAX, journalId, rowFromForm, type JournalForm } from '../rules/journal'
import type { DojoDB } from './db'
import type { JournalRow } from './types'

/**
 * Save the entry for a day (JOURNAL-05, JOURNAL-12): one row per local day, replaced whole by every save. Writes only `journal`: no
 * XP, no event, no ticket, no redo, no pulse. A blank entry and a future day write nothing. Called only from the Save click.
 */
export async function saveJournal(d: DojoDB, form: JournalForm, day: string, listedIds: readonly string[], nowMs: number): Promise<JournalRow | null> {
  if (day > localDayKey(nowMs) || !canSave(form, listedIds)) return null
  const row = rowFromForm(form, day, listedIds, nowMs)
  return d.transaction('rw', d.journal, async () => {
    // W5 (JOURNAL-31): a day that had a Floor session keeps its flag and line when the entry is saved as studied; a no-study save replaces the row
    const prior = await d.journal.get(journalId(day))
    const keep = row.mode === 'studied' && prior?.floor ? { floor: true as const, ...(prior.line ? { line: prior.line } : {}) } : {}
    const out: JournalRow = { ...row, ...keep }
    await d.journal.put({ ...out, id: journalId(day) })
    return out
  })
}

/**
 * Save the Floor session's line (RIT-46, RIT-47): today's row becomes `studied` with `line` and `floor: true`, keeping everything a studied
 * entry already holds. A no-study row is replaced (he did study). A blank line writes nothing. A studied Journal row counts as an
 * active day. Called only from the Floor Save click.
 */
export async function saveFloorLine(d: DojoDB, raw: string, nowMs: number): Promise<JournalRow | null> {
  const line = raw.trim().slice(0, JOURNAL_LINE_MAX).trim()
  if (!line) return null
  const day = localDayKey(nowMs)
  return d.transaction('rw', d.journal, async () => {
    const prior = await d.journal.get(journalId(day))
    const base: JournalRow = prior?.mode === 'studied' ? prior : { id: journalId(day), day, at: nowMs, mode: 'studied', items: [] }
    const row: JournalRow = { ...base, at: nowMs, line, floor: true }
    await d.journal.put(row)
    return row
  })
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

// C-RUNNER §4 / C-PYTHON §4: the learner's code for a pack ticket, one row per (ticket, language), saved as he
// types (the editor debounces) through the normal Dexie write path, so it reaches disk through the outbox like
// every other change. The most recently written row of a ticket carries `lastLang: true`: the language the
// panel reopens on.
import type { DojoDB } from './db'
import type { CodeRow } from './types'

export type Lang = CodeRow['lang']

export async function loadCode(d: DojoDB, ticketId: string, lang: Lang = 'go'): Promise<CodeRow | null> {
  return (await d.code.get([ticketId, lang])) ?? null
}

/** Every row of a ticket (at most one per language). */
export function codeRows(d: DojoDB, ticketId: string): Promise<CodeRow[]> {
  return d.code.where('ticketId').equals(ticketId).toArray()
}

/** The language a ticket's panel opens on: the row marked lastLang, else Go. */
export function lastLang(rows: CodeRow[]): Lang {
  return rows.find(r => r.lastLang)?.lang ?? 'go'
}

/** Marks `lang`'s row the ticket's last one; the other row (if it was) loses the mark and keeps its text and time. */
async function markLast(d: DojoDB, ticketId: string, lang: Lang): Promise<void> {
  const other = await d.code.get([ticketId, lang === 'go' ? 'py' : 'go'])
  if (other?.lastLang) await d.code.put({ ...other, lastLang: false })
}

/** Puts the row (and makes it the last); false (and no write) when the source is unchanged and it already is. */
export async function saveCode(d: DojoDB, ticketId: string, source: string, nowMs: number, lang: Lang = 'go'): Promise<boolean> {
  return d.transaction('rw', d.code, async () => {
    const cur = await d.code.get([ticketId, lang])
    if (cur && cur.source === source && cur.lastLang) return false
    if (cur && cur.source === source && (await codeRows(d, ticketId)).length === 1 && cur.lastLang === undefined) return false // a 4a row alone: nothing to say
    await markLast(d, ticketId, lang)
    await d.code.put(cur && cur.source === source ? { ...cur, lastLang: true } : { ticketId, lang, source, updatedAt: nowMs, lastLang: true })
    return true
  })
}

/** The learner picked a language: it becomes the ticket's last. A missing row is created from the starter. */
export async function chooseLang(d: DojoDB, ticketId: string, lang: Lang, starter: string, nowMs: number): Promise<boolean> {
  return d.transaction('rw', d.code, async () => {
    const cur = await d.code.get([ticketId, lang])
    if (cur?.lastLang) return false
    await markLast(d, ticketId, lang)
    await d.code.put(cur ? { ...cur, lastLang: true } : { ticketId, lang, source: starter, updatedAt: nowMs, lastLang: true })
    return true
  })
}

import Dexie from 'dexie'
import type { DojoDB } from './db'
import type { CodeRow } from './types'
import { idMapOfPairs, mergeCodeGroup, remapEvent, remapSession, remapTicketRefs, type CodeGroupEntry } from '../rules/remapIds'

export const REMAP_TABLE_NAMES = [
  'tickets', 'sessions', 'events', 'redos', 'rungUses', 'checkAttempts', 'code', 'grades', 'bankItems', 'designSessions', 'aiLog', 'pictures',
] as const

/** The tables a ticket-id rename can touch; a caller's transaction must include them. */
export const remapTables = (d: DojoDB) => REMAP_TABLE_NAMES.map(n => d.table(n))

/** Moves every reference to `from` onto `to`, in every table (single hop: chained pairs throw; code rows that land on one (container, language) merge into one row, newest source first and the older ones commented out, MIG-08, exactly as in remapRows). Returns the rows changed per table. */
export async function remapTicketIds(d: DojoDB, pairs: ReadonlyArray<{ from: string; to: string }>): Promise<Record<string, number>> {
  const m = idMapOfPairs(pairs)
  if (m.size === 0) return {}
  return d.transaction('rw', remapTables(d), async () => {
    const counts: Record<string, number> = {}
    const bump = (t: string) => { counts[t] = (counts[t] ?? 0) + 1 }
    const codeGroups = new Map<string, CodeGroupEntry[]>() // per (to, lang): the existing destination row and every moved row
    for (const [from, to] of m) {
      await d.redos.where('ticketId').equals(from).modify(r => { r.ticketId = to; bump('redos') })
      await d.rungUses.where('ticketId').equals(from).modify(r => { r.ticketId = to; bump('rungUses') })
      await d.checkAttempts.where('ticketId').equals(from).modify(r => { r.ticketId = to; bump('checkAttempts') })
      await d.aiLog.where('ticketId').equals(from).modify(r => { r.ticketId = to; bump('aiLog') })
      await d.bankItems.where('ticketId').equals(from).modify(r => { r.ticketId = to; bump('bankItems') })
      await d.designSessions.where('designId').equals(from).modify(r => { r.designId = to; bump('designSessions') })
      await d.grades.where('targetId').equals(from).filter(g => g.targetKind === 'ticket').modify(g => { g.targetId = to; bump('grades') })
      for (const row of await d.code.where('[ticketId+lang]').between([from, Dexie.minKey], [from, Dexie.maxKey]).toArray()) {
        const k = `${to}:${row.lang}`
        let g = codeGroups.get(k)
        if (!g) {
          const have = await d.code.get([to, row.lang])
          g = have ? [{ orig: to, row: have }] : []
          codeGroups.set(k, g)
        }
        g.push({ orig: from, row: { ...row, ticketId: to } })
        bump('code')
      }
      const pic = await d.pictures.get(from)
      if (pic) {
        const have = await d.pictures.get(to)
        await d.pictures.delete(from)
        if (!have || have.createdAt <= pic.createdAt) await d.pictures.put({ ...pic, key: to })
        bump('pictures')
      }
    }
    for (const g of codeGroups.values()) {
      const merged: CodeRow = mergeCodeGroup(g)
      for (const e of g) await d.code.delete([e.orig, e.row.lang])
      await d.code.put(merged)
    }
    await d.sessions.filter(r => remapSession(r, m) !== r).modify(r => { Object.assign(r, remapSession(r, m)); bump('sessions') })
    await d.events.filter(e => remapEvent(e, m) !== e).modify(e => { Object.assign(e, remapEvent(e, m)); bump('events') })
    await d.tickets.filter(t => remapTicketRefs(t, m) !== t).modify(t => { Object.assign(t, remapTicketRefs(t, m)); bump('tickets') })
    return counts
  })
}

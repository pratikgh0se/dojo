// R1 W2: the journal's two writes. Save replaces one row per local day; Add to Review writes one open journal_hard redo.
import { describe, expect, it } from 'vitest'
import { addHardToReview, saveJournal } from '../../src/data/journalActions'
import { emptyForm } from '../../src/rules/journal'
import { reviewCards } from '../../src/rules/reviewQueue'
import { freshDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const NOW = at(2026, 11, 4, 10, 0)

describe('saveJournal', () => {
  it('writes journal-<day> and nothing else (JOURNAL-05)', async () => {
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'a', status: 'done', doneAt: at(2026, 11, 4, 9) }))
    const form = { ...emptyForm(), hardest: ' H ', picks: { a: { rating: 'hard' as const, explain: 'partly' as const } } }
    const row = await saveJournal(d, form, '2026-11-04', ['a'], NOW)
    expect(row).toEqual({ id: 'journal-2026-11-04', day: '2026-11-04', at: NOW, mode: 'studied', items: [{ ticketId: 'a', rating: 'hard', explain: 'partly' }], hardest: 'H' })
    expect(await d.journal.toArray()).toEqual([row])
    for (const t of ['sessions', 'redos', 'pulses', 'events'] as const) expect(await d.table(t).count(), t).toBe(0)
    expect((await d.tickets.get('a'))?.xp).toBe(0)
  })
  it('a second save replaces the same row and takes the new time (JOURNAL-07)', async () => {
    const d = freshDb()
    await saveJournal(d, { ...emptyForm(), notes: 'one' }, '2026-11-04', [], NOW)
    await saveJournal(d, { ...emptyForm(), notes: 'two' }, '2026-11-04', [], NOW + 60_000)
    const rows = await d.journal.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ notes: 'two', at: NOW + 60_000 })
  })
  it('an earlier day writes only that day\'s row, stamped with the time of the save (JOURNAL-08, JOURNAL-10)', async () => {
    const d = freshDb()
    await saveJournal(d, { ...emptyForm(), notes: 'Read about vector clocks on the train' }, '2026-11-01', [], NOW)
    expect(await d.journal.toArray()).toEqual([{ id: 'journal-2026-11-01', day: '2026-11-01', at: NOW, mode: 'studied', items: [], notes: 'Read about vector clocks on the train' }])
  })
  it('writes nothing for a blank entry, an obstacle-less no-study entry or a future day (JOURNAL-06, JOURNAL-09, JOURNAL-11)', async () => {
    const d = freshDb()
    expect(await saveJournal(d, { ...emptyForm(), hardest: '   ' }, '2026-11-04', [], NOW)).toBeNull()
    expect(await saveJournal(d, { ...emptyForm(), mode: 'none' }, '2026-11-04', [], NOW)).toBeNull()
    expect(await saveJournal(d, { ...emptyForm(), notes: 'x' }, '2026-11-05', [], NOW)).toBeNull()
    expect(await d.journal.count()).toBe(0)
  })
  it('turning a no-study day back into a study day replaces the row (JOURNAL-13)', async () => {
    const d = freshDb()
    await saveJournal(d, { ...emptyForm(), mode: 'none', obstacle: 'job', line: 'L' }, '2026-11-04', ['a', 'b'], NOW)
    await saveJournal(d, { ...emptyForm(), picks: { a: { rating: 'good', explain: null } } }, '2026-11-04', ['a', 'b'], NOW + 1)
    const rows = await d.journal.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ id: 'journal-2026-11-04', day: '2026-11-04', at: NOW + 1, mode: 'studied', items: [{ ticketId: 'a', rating: 'good', explain: null }, { ticketId: 'b', rating: null, explain: null }] })
  })
})

describe('addHardToReview', () => {
  const watch = mkTicket({ id: 'w', kind: 'watch', lane: 'path', title: 'Attention', status: 'done', explain: ['Q?'], explainAnswers: ['A.'] })
  const problem = mkTicket({ id: 'p', kind: 'problem', lane: 'dsa', title: 'Two sum', status: 'done' })

  it('writes one journal_hard redo due today with the ticket\'s explain piece, and nothing else (JOURNAL-20)', async () => {
    const d = freshDb()
    await d.tickets.bulkPut([watch, problem])
    expect(await addHardToReview(d, 'w', NOW)).toBe('added')
    expect(await d.redos.toArray()).toEqual([{
      id: 'jh-w-2026-11-04', ticketId: 'w', source: 'journal_hard', createdAt: NOW, stage: 0, due: '2026-11-04', passed: [], helpCost: 0, refunded: 0,
      piece: { topic: 'Attention', question: 'Q?', answer: 'A.' },
    }])
    for (const t of ['sessions', 'journal', 'pulses', 'events'] as const) expect(await d.table(t).count(), t).toBe(0)
  })
  it('a ticket without an explain question gets a redo with no piece (JOURNAL-21)', async () => {
    const d = freshDb()
    await d.tickets.bulkPut([watch, problem])
    await addHardToReview(d, 'p', NOW)
    const r = await d.redos.get('jh-p-2026-11-04')
    expect(r && 'piece' in r).toBe(false)
  })
  it('a second add while one is open writes nothing (JOURNAL-22), also on a later day', async () => {
    const d = freshDb()
    await d.tickets.bulkPut([watch])
    await addHardToReview(d, 'w', NOW)
    expect(await addHardToReview(d, 'w', NOW + 1000)).toBe('exists')
    expect(await addHardToReview(d, 'w', at(2026, 11, 5))).toBe('exists')
    expect(await d.redos.count()).toBe(1)
  })
  it('once the redo is closed the ticket can be added again', async () => {
    const d = freshDb()
    await d.tickets.bulkPut([watch])
    await addHardToReview(d, 'w', NOW)
    await d.redos.update('jh-w-2026-11-04', { closedAt: NOW + 5 })
    expect(await addHardToReview(d, 'w', at(2026, 11, 6))).toBe('added')
    expect((await d.redos.toArray()).filter(r => r.closedAt === undefined)).toHaveLength(1)
  })
  it('an archived or missing ticket gets nothing', async () => {
    const d = freshDb()
    await d.tickets.put({ ...watch, archived: true })
    expect(await addHardToReview(d, 'w', NOW)).toBe('gone')
    expect(await addHardToReview(d, 'nope', NOW)).toBe('gone')
    expect(await d.redos.count()).toBe(0)
  })
  it('the redo is due on the clock day: it is a Review card at once, check with a piece, replay without (review.md)', async () => {
    const d = freshDb()
    await d.tickets.bulkPut([watch, problem, mkTicket({ id: 'r', kind: 'read', lane: 'path', title: 'No question', status: 'done' })])
    for (const id of ['w', 'p', 'r']) await addHardToReview(d, id, NOW)
    const cards = reviewCards({ redos: await d.redos.toArray(), tickets: await d.tickets.toArray(), nowMs: NOW })
    const by = Object.fromEntries(cards.map(c => [c.ticketId, c]))
    expect(by.w).toMatchObject({ kind: 'check', prompt: 'Q?', stored: 'A.', ticketKind: 'watch' })
    expect(by.p).toMatchObject({ kind: 'replay', ticketKind: 'problem', redoLabel: 'REDO · PROBLEM', to: '/do/p' })
    expect(by.r).toMatchObject({ kind: 'replay', ticketKind: 'read', to: '/do/r' }) // a replay card whatever its ticket's kind
    expect(by.r.stored).toBe('')
    expect(by.r.prompt.length).toBeGreaterThan(0)
  })
})

import { saveFloorLine } from '../../src/data/journalActions'
import { activeDaysOf } from '../../src/rules/restart'

describe('saveFloorLine', () => {
  it('writes today\'s studied row with the line and floor: true, with exactly these keys, and nothing else', async () => {
    const d = freshDb()
    const row = await saveFloorLine(d, '  Read about batching  ', NOW)
    expect(row).toEqual({ id: 'journal-2026-11-04', day: '2026-11-04', at: NOW, mode: 'studied', items: [], line: 'Read about batching', floor: true })
    expect(await d.journal.toArray()).toEqual([row])
    for (const t of ['sessions', 'redos', 'pulses', 'events', 'tickets'] as const) expect(await d.table(t).count(), t).toBe(0)
  })
  it('keeps what a studied entry already holds and replaces the line on a second save (one row for the day)', async () => {
    const d = freshDb()
    await saveJournal(d, { ...emptyForm(), hardest: 'Little\'s law', next: 'Sweep' }, '2026-11-04', [], NOW)
    await saveFloorLine(d, 'one', NOW + 1)
    await saveFloorLine(d, 'two', NOW + 2)
    const rows = await d.journal.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ mode: 'studied', hardest: 'Little\'s law', next: 'Sweep', line: 'two', floor: true, at: NOW + 2 })
  })
  it('turns a no-study day into a studied floor day without the obstacle', async () => {
    const d = freshDb()
    await saveJournal(d, { ...emptyForm(), mode: 'none', obstacle: 'energy' }, '2026-11-04', [], NOW)
    const row = await saveFloorLine(d, 'Short one', NOW + 1)
    expect(row).toMatchObject({ mode: 'studied', items: [], line: 'Short one', floor: true })
    expect(row).not.toHaveProperty('obstacle')
    expect(await d.journal.count()).toBe(1)
  })
  it('caps the line at 200 and writes nothing for a blank line', async () => {
    const d = freshDb()
    expect(await saveFloorLine(d, '   ', NOW)).toBeNull()
    expect(await d.journal.count()).toBe(0)
    expect((await saveFloorLine(d, 'x'.repeat(250), NOW))!.line).toHaveLength(200)
  })
  it('a later normal Save of the same day keeps the floor flag and line; a no-study save drops them (JOURNAL-31)', async () => {
    const d = freshDb()
    await saveFloorLine(d, 'kept', NOW)
    await saveJournal(d, { ...emptyForm(), notes: 'later note' }, '2026-11-04', [], NOW + 5)
    expect((await d.journal.toArray())[0]).toMatchObject({ notes: 'later note', line: 'kept', floor: true, at: NOW + 5 })
    await saveJournal(d, { ...emptyForm(), mode: 'none', obstacle: 'time', line: 'Out of time' }, '2026-11-04', [], NOW + 9)
    const none = (await d.journal.toArray())[0]
    expect(none).toMatchObject({ mode: 'none', obstacle: 'time', line: 'Out of time', items: [] })
    expect(none).not.toHaveProperty('floor')
  })
  it('a studied entry on a day with no Floor session has no floor key and no line key (JOURNAL-05)', async () => {
    const d = freshDb()
    const row = await saveJournal(d, { ...emptyForm(), notes: 'n' }, '2026-11-04', [], NOW)
    expect(row).not.toHaveProperty('floor')
    expect(row).not.toHaveProperty('line')
  })
  it('a floor day counts as an active day', async () => {
    const d = freshDb()
    await saveFloorLine(d, 'x', NOW)
    expect([...activeDaysOf({ tickets: [], sessions: [], journal: await d.journal.toArray() })]).toEqual(['2026-11-04'])
  })
})

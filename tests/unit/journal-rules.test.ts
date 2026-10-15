// R1 W2: the daily journal's pure rules (docs/contracts/journal.md). Local times: the unit suite runs in TZ=Asia/Kolkata.
import { describe, expect, it } from 'vitest'
import type { JournalRow, Ticket } from '../../src/data/types'
import {
  addDayKeys, canSave, emptyForm, formFromRow, hardCounts, hardList, hardRedo, hardRedoId, hasHardSignal, isSaved, journalCardState,
  JOURNAL_CARD_HOUR, JOURNAL_LINE_MAX, JOURNAL_TEXT_MAX, journalId, listedFor, pieceOf, resolveDay, rowFromForm, shortWeekday, stripOf, toggle,
} from '../../src/rules/journal'
import { mkTicket } from '../helpers/tickets'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const TODAY = '2026-11-04'
const NOW = at(2026, 11, 4, 10, 0)

const row = (day: string, items: JournalRow['items'], extra: Partial<JournalRow> = {}): JournalRow =>
  ({ id: journalId(day), day, at: 1, mode: 'studied', items, ...extra })
const done = (id: string, y: number, m: number, d: number, h: number, min = 0, extra: Partial<Ticket> = {}): Ticket =>
  mkTicket({ id, status: 'done', doneAt: at(y, m, d, h, min), ...extra })

describe('day keys', () => {
  it('journalId is journal-<day>', () => expect(journalId('2026-11-04')).toBe('journal-2026-11-04'))
  it('addDayKeys moves a calendar day across month and year edges', () => {
    expect(addDayKeys('2026-11-04', -6)).toBe('2026-10-29')
    expect(addDayKeys('2026-11-04', -13)).toBe('2026-10-22')
    expect(addDayKeys('2026-12-30', 3)).toBe('2027-01-02')
  })
  it('shortWeekday names the weekday of a day key', () => {
    expect(shortWeekday('2026-11-04')).toBe('Wed')
    expect(shortWeekday('2026-11-01')).toBe('Sun')
  })
  it('resolveDay: a valid day on or before the clock day stays; a future, invalid or missing one is the clock day (JOURNAL-09)', () => {
    expect(resolveDay('2026-11-03', TODAY)).toBe('2026-11-03')
    expect(resolveDay('2026-11-04', TODAY)).toBe('2026-11-04')
    expect(resolveDay('2026-11-05', TODAY)).toBe(TODAY)
    expect(resolveDay('2027-01-01', TODAY)).toBe(TODAY)
    expect(resolveDay('nonsense', TODAY)).toBe(TODAY)
    expect(resolveDay('2026-02-30', TODAY)).toBe(TODAY)
    expect(resolveDay(null, TODAY)).toBe(TODAY)
    expect(resolveDay('', TODAY)).toBe(TODAY)
  })
})

describe('listedFor (JOURNAL-02: done that day, not archived, ascending doneAt)', () => {
  const tickets = [
    done('c', 2026, 11, 4, 9, 5),
    done('a', 2026, 11, 4, 0, 10), // 00:10 is on the day
    done('b', 2026, 11, 4, 8, 20),
    done('late-yesterday', 2026, 11, 3, 23, 50),
    done('arch', 2026, 11, 4, 9, 0, { archived: true }),
    mkTicket({ id: 'open', status: 'todo' }),
    mkTicket({ id: 'doing', status: 'doing' }),
    mkTicket({ id: 'blocked', status: 'blocked' as Ticket['status'], doneAt: at(2026, 11, 4, 9, 0) }),
  ]
  it('lists only the day\'s done, live tickets in doneAt order', () => {
    expect(listedFor(tickets, '2026-11-04').map(t => t.id)).toEqual(['a', 'b', 'c'])
    expect(listedFor(tickets, '2026-11-03').map(t => t.id)).toEqual(['late-yesterday'])
    expect(listedFor(tickets, '2026-11-01')).toEqual([])
  })
  it('ignores lane and kind', () => {
    const t = [done('x', 2026, 11, 4, 9, 0, { lane: 'dsa', kind: 'problem' }), done('y', 2026, 11, 4, 10, 0, { lane: 'design', kind: 'design' })]
    expect(listedFor(t, '2026-11-04').map(x => x.id)).toEqual(['x', 'y'])
  })
})

describe('the hard signal and the 14-day count (JOURNAL-18, JOURNAL-19)', () => {
  const sig = (rating: JournalRow['items'][number]['rating'], explain: JournalRow['items'][number]['explain']) => hasHardSignal({ rating, explain })
  it('Again, Hard or explain No is a signal; Good, Easy, Partly, Yes and blank are not', () => {
    expect(sig('again', null)).toBe(true)
    expect(sig('hard', null)).toBe(true)
    expect(sig(null, 'no')).toBe(true)
    expect(sig('good', 'yes')).toBe(false)
    expect(sig('easy', 'partly')).toBe(false)
    expect(sig(null, null)).toBe(false)
  })
  const rows = [
    row('2026-10-21', [{ ticketId: 'once', rating: 'hard', explain: null }]),
    row('2026-10-22', [{ ticketId: 'hard', rating: null, explain: 'no' }]),
    row('2026-10-31', [{ ticketId: 'hard2', rating: 'hard', explain: null }, { ticketId: 't2', rating: null, explain: 'no' }]),
    row('2026-11-02', [], { mode: 'none', obstacle: 'job' }),
    row('2026-11-03', [
      { ticketId: 'hard', rating: 'hard', explain: 'partly' }, { ticketId: 'once', rating: 'again', explain: 'yes' },
      { ticketId: 'good', rating: 'good', explain: 'yes' }, { ticketId: 'hard2', rating: 'again', explain: null },
    ]),
  ]
  it('counts signals in the 14 days ending on the clock day; the 14th day before is outside', () => {
    const c = hardCounts(rows, TODAY)
    expect(c.get('hard')).toEqual({ count: 2, latest: '2026-11-03' })
    expect(c.get('hard2')).toEqual({ count: 2, latest: '2026-11-03' })
    expect(c.get('t2')).toEqual({ count: 1, latest: '2026-10-31' })
    expect(c.get('once')).toEqual({ count: 1, latest: '2026-11-03' }) // 2026-10-21 is outside
    expect(c.get('good')).toBeUndefined()
  })
  it('two signals on one item count once', () => {
    const c = hardCounts([row('2026-11-04', [{ ticketId: 'a', rating: 'hard', explain: 'no' }])], TODAY)
    expect(c.get('a')).toEqual({ count: 1, latest: '2026-11-04' })
  })
  it('is anchored on the clock day, whichever day is shown', () => {
    expect(hardCounts(rows, '2026-11-04').get('once')?.count).toBe(1)
    expect(hardCounts(rows, '2026-11-03').get('once')?.count).toBe(2) // window 2026-10-21 to 2026-11-03
  })
  it('hardList: two or more, highest count first, then newest latest signal, then ticket id; live tickets only', () => {
    const tickets = ['hard', 'hard2', 't2', 'once', 'good'].map(id => mkTicket({ id, title: `T ${id}` }))
    expect(hardList(rows, tickets, TODAY).map(h => [h.ticket.id, h.count])).toEqual([['hard', 2], ['hard2', 2]])
    const more = [...rows, row('2026-11-04', [{ ticketId: 't2', rating: 'hard', explain: null }])]
    expect(hardList(more, tickets, TODAY).map(h => [h.ticket.id, h.count, h.latest])).toEqual([['t2', 2, '2026-11-04'], ['hard', 2, '2026-11-03'], ['hard2', 2, '2026-11-03']])
    const three = [...more, row('2026-11-05', [{ ticketId: 'hard2', rating: 'hard', explain: null }])]
    expect(hardList(three, tickets, '2026-11-05')[0].ticket.id).toBe('hard2') // count 3 first
    expect(hardList(rows, [mkTicket({ id: 'hard' }), mkTicket({ id: 'hard2', archived: true })], TODAY).map(h => h.ticket.id)).toEqual(['hard'])
  })
  it('rows count whatever the ticket\'s current doneAt is', () => {
    const t = mkTicket({ id: 'hard', status: 'todo' })
    expect(hardList(rows, [t], TODAY).map(h => h.ticket.id)).toEqual(['hard'])
  })
})

describe('the strip (JOURNAL-15)', () => {
  const rows = [
    row('2026-10-31', [{ ticketId: 'a', rating: 'good', explain: null }]),
    row('2026-11-02', [], { mode: 'none', obstacle: 'job' }),
    row('2026-11-03', [{ ticketId: 'a', rating: 'good', explain: null }]),
  ]
  it('is seven cells, oldest first, ending on the clock day', () => {
    const s = stripOf(rows, TODAY)
    expect(s.map(c => c.day)).toEqual(['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'])
    expect(s.map(c => c.state)).toEqual(['blank', 'blank', 'written', 'blank', 'none', 'written', 'blank'])
  })
  it('after five quiet days only the seven recent days show (JOURNAL-17)', () => {
    const s = stripOf(rows, '2026-11-09')
    expect(s.map(c => c.day)[0]).toBe('2026-11-03')
    expect(s.map(c => c.state)).toEqual(['written', 'blank', 'blank', 'blank', 'blank', 'blank', 'blank'])
  })
})

describe('the form (JOURNAL-03 to JOURNAL-07, JOURNAL-11 to JOURNAL-13)', () => {
  const listed = [mkTicket({ id: 'a' }), mkTicket({ id: 'b' }), mkTicket({ id: 'c' })]
  const ids = listed.map(t => t.id)
  it('a fresh form has nothing pressed and cannot be saved', () => {
    const f = emptyForm()
    expect(f.mode).toBe('studied')
    expect(canSave(f, ids)).toBe(false)
    expect(isSaved(f, null, ids)).toBe(false)
  })
  it('toggle sets an option and pressing it again clears it', () => {
    expect(toggle(null, 'hard')).toBe('hard')
    expect(toggle('hard', 'hard')).toBeNull()
    expect(toggle('hard', 'good')).toBe('good')
  })
  it('Save needs a rating, an explain option or non-blank text (whitespace is blank)', () => {
    expect(canSave({ ...emptyForm(), hardest: '   ' }, ids)).toBe(false)
    expect(canSave({ ...emptyForm(), hardest: ' x ' }, ids)).toBe(true)
    expect(canSave({ ...emptyForm(), notes: 'n' }, ids)).toBe(true)
    expect(canSave({ ...emptyForm(), next: 'n' }, ids)).toBe(true)
    expect(canSave({ ...emptyForm(), picks: { a: { rating: 'good', explain: null } } }, ids)).toBe(true)
    expect(canSave({ ...emptyForm(), picks: { a: { rating: null, explain: 'yes' } } }, ids)).toBe(true)
    expect(canSave({ ...emptyForm(), picks: { zzz: { rating: 'good', explain: null } } }, ids)).toBe(false) // not a listed ticket
  })
  it('rowFromForm (JOURNAL-05): one item per listed ticket in list order, trimmed text, absent keys for blanks', () => {
    const f = {
      ...emptyForm(), hardest: '  Cache invalidation order  ', next: 'Finish the benchmark write-up', notes: '   ',
      picks: { a: { rating: 'hard' as const, explain: 'partly' as const }, b: { rating: 'good' as const, explain: null } },
    }
    expect(rowFromForm(f, TODAY, ids, NOW)).toEqual({
      id: 'journal-2026-11-04', day: TODAY, at: NOW, mode: 'studied',
      items: [{ ticketId: 'a', rating: 'hard', explain: 'partly' }, { ticketId: 'b', rating: 'good', explain: null }, { ticketId: 'c', rating: null, explain: null }],
      hardest: 'Cache invalidation order', next: 'Finish the benchmark write-up',
    })
    const r = rowFromForm(f, TODAY, ids, NOW)
    expect('notes' in r).toBe(false)
    expect('obstacle' in r).toBe(false)
    expect('line' in r).toBe(false)
  })
  it('rowFromForm caps text at 1000 and the line at 200', () => {
    expect(JOURNAL_TEXT_MAX).toBe(1000)
    expect(JOURNAL_LINE_MAX).toBe(200)
    const f = { ...emptyForm(), hardest: 'x'.repeat(1200), mode: 'none' as const, obstacle: 'time' as const, line: 'y'.repeat(250) }
    expect(rowFromForm({ ...f, mode: 'studied' }, TODAY, ids, NOW).hardest).toHaveLength(1000)
    expect(rowFromForm(f, TODAY, ids, NOW).line).toHaveLength(200)
  })
  it('a no-study row (JOURNAL-12): mode none, obstacle, optional line, no items and no text keys', () => {
    const f = { ...emptyForm(), mode: 'none' as const, obstacle: 'job' as const, line: '  Wanted to finish the attention paper ', hardest: 'kept in form only', picks: { a: { rating: 'good' as const, explain: null } } }
    expect(canSave({ ...f, obstacle: null }, ids)).toBe(false)
    expect(canSave(f, ids)).toBe(true)
    expect(rowFromForm(f, TODAY, ids, NOW)).toEqual({ id: 'journal-2026-11-04', day: TODAY, at: NOW, mode: 'none', items: [], obstacle: 'job', line: 'Wanted to finish the attention paper' })
    const blankLine = rowFromForm({ ...f, line: '  ' }, TODAY, ids, NOW)
    expect('line' in blankLine).toBe(false)
  })
  it('an empty day saves a studied row with no items when there is text (JOURNAL-10)', () => {
    const f = { ...emptyForm(), notes: 'Read about vector clocks on the train' }
    expect(canSave(f, [])).toBe(true)
    expect(rowFromForm(f, '2026-11-01', [], NOW)).toEqual({ id: 'journal-2026-11-01', day: '2026-11-01', at: NOW, mode: 'studied', items: [], notes: 'Read about vector clocks on the train' })
  })
  it('formFromRow shows a stored row; a no-study row stores no items so the studied form is blank (JOURNAL-13)', () => {
    const stored = row(TODAY, [{ ticketId: 'a', rating: 'hard', explain: 'partly' }, { ticketId: 'b', rating: 'good', explain: null }], { hardest: 'H', next: 'N' })
    const f = formFromRow(stored)
    expect(f.picks).toEqual({ a: { rating: 'hard', explain: 'partly' }, b: { rating: 'good', explain: null } })
    expect([f.hardest, f.next, f.notes]).toEqual(['H', 'N', ''])
    const none = formFromRow(row(TODAY, [], { mode: 'none', obstacle: 'job', line: 'L' }))
    expect(none).toMatchObject({ mode: 'none', obstacle: 'job', line: 'L', picks: {} })
    expect(canSave({ ...none, mode: 'studied' }, ids)).toBe(false)
  })
  it('isSaved: the form equals the stored row (item order and the row\'s time do not matter)', () => {
    const stored = row(TODAY, [{ ticketId: 'c', rating: 'easy', explain: null }, { ticketId: 'a', rating: 'hard', explain: 'partly' }, { ticketId: 'b', rating: null, explain: null }], { hardest: 'H' })
    const f = formFromRow(stored)
    expect(isSaved(f, stored, ids)).toBe(true)
    expect(isSaved({ ...f, notes: 'x' }, stored, ids)).toBe(false)
    expect(isSaved({ ...f, picks: { ...f.picks, a: { rating: 'good', explain: 'partly' } } }, stored, ids)).toBe(false)
    expect(isSaved({ ...f, mode: 'none', obstacle: 'time' }, stored, ids)).toBe(false)
    expect(isSaved({ ...f, hardest: 'H ' }, stored, ids)).toBe(true) // trailing space trims to the stored text
    expect(isSaved(f, null, ids)).toBe(false)
  })
  it('isSaved for a no-study row compares mode, obstacle and line only', () => {
    const stored = row(TODAY, [], { mode: 'none', obstacle: 'job', line: 'L' })
    const f = formFromRow(stored)
    expect(isSaved(f, stored, ids)).toBe(true)
    expect(isSaved({ ...f, obstacle: 'time' }, stored, ids)).toBe(false)
    expect(isSaved({ ...f, line: '' }, stored, ids)).toBe(false)
    expect(isSaved({ ...f, hardest: 'typed while hidden' }, stored, ids)).toBe(true)
  })
})

describe('Add to Review (JOURNAL-20, JOURNAL-21)', () => {
  it('hardRedoId is jh-<ticket>-<clock day>', () => expect(hardRedoId('t1', TODAY)).toBe('jh-t1-2026-11-04'))
  it('pieceOf: topic is the title, question explain[0], answer explainAnswers[0]; none without both', () => {
    const t = mkTicket({ id: 'w', title: 'Attention', kind: 'watch', explain: ['Why scale by sqrt(d)?', 'q2'], explainAnswers: ['Keeps softmax out of saturation.', 'a2'] })
    expect(pieceOf(t)).toEqual({ topic: 'Attention', question: 'Why scale by sqrt(d)?', answer: 'Keeps softmax out of saturation.' })
    expect(pieceOf(mkTicket({ id: 'p', kind: 'problem' }))).toBeNull()
    expect(pieceOf(mkTicket({ id: 'q', explain: ['only a question'] }))).toBeNull()
    expect(pieceOf(mkTicket({ id: 'r', explain: ['  '], explainAnswers: ['a'] }))).toBeNull()
  })
  it('hardRedo with a piece: journal_hard, stage 0, due on the clock day, no closedAt', () => {
    const t = mkTicket({ id: 'w', title: 'Attention', kind: 'watch', explain: ['Q'], explainAnswers: ['A'] })
    expect(hardRedo(t, TODAY, NOW)).toEqual({
      id: 'jh-w-2026-11-04', ticketId: 'w', source: 'journal_hard', createdAt: NOW, stage: 0, due: TODAY, passed: [], helpCost: 0, refunded: 0,
      piece: { topic: 'Attention', question: 'Q', answer: 'A' },
    })
  })
  it('hardRedo without an explain question carries no piece key', () => {
    const r = hardRedo(mkTicket({ id: 'p', kind: 'problem' }), TODAY, NOW)
    expect('piece' in r).toBe(false)
    expect(r.source).toBe('journal_hard')
  })
})

describe('the Today card (TODAY-49)', () => {
  const r = row(TODAY, [{ ticketId: 'a', rating: 'good', explain: null }])
  it('appears from 17:00 local', () => {
    expect(JOURNAL_CARD_HOUR).toBe(17)
    expect(journalCardState(at(2026, 11, 4, 10, 0), [])).toBeNull()
    expect(journalCardState(at(2026, 11, 4, 16, 59), [])).toBeNull()
    expect(journalCardState(at(2026, 11, 4, 17, 0), [])).toBe('open')
    expect(journalCardState(at(2026, 11, 4, 23, 59), [])).toBe('open')
  })
  it('reads saved once the clock day has a row of either mode, and never refers to another day', () => {
    expect(journalCardState(at(2026, 11, 4, 17, 0), [r])).toBe('saved')
    expect(journalCardState(at(2026, 11, 4, 17, 0), [row(TODAY, [], { mode: 'none', obstacle: 'time' })])).toBe('saved')
    expect(journalCardState(at(2026, 11, 9, 17, 0), [r])).toBe('open') // five days on: an old row does not count, and no extra state exists
  })
})

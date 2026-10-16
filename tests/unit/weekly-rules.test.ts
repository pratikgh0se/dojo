import { describe, expect, it } from 'vitest'
import type { JournalRow, Redo, Session } from '../../src/data/types'
import {
  emptyWeeklyForm, fmtHm, latestFocus, nextWeekKey, prevWeekKey, resolveWeek, weekEnd, weekRangeLabel, weekStart, weekSummary,
  weeklyBlank, weeklyFormFromRow, weeklyId, weeklyRow, weeklySaved,
} from '../../src/rules/weekly'
import { mkTicket } from '../helpers/planV2'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()

describe('week keys', () => {
  it('weekStart is Monday 00:00 local; weekEnd is the next Monday 00:00', () => {
    expect(weekStart('2026-W45')).toBe(at(2026, 11, 2, 0, 0))
    expect(weekEnd('2026-W45')).toBe(at(2026, 11, 9, 0, 0))
  })
  const edges: [string, boolean][] = [['2026-W53', true], ['2027-W01', true], ['2026-W54', false], ['2026-W00', false], ['2025-W53', false], ['junk', false], ['2026-W5', false]]
  for (const [k, ok] of edges) it(`validates ${k}`, () => expect(weekStart(k) !== null).toBe(ok))
  it('previous and next cross the year edge (2026 has 53 ISO weeks)', () => {
    expect(prevWeekKey('2027-W01')).toBe('2026-W53')
    expect(nextWeekKey('2026-W53')).toBe('2027-W01')
    expect(prevWeekKey('2026-W45')).toBe('2026-W44')
    expect(nextWeekKey('2026-W44')).toBe('2026-W45')
  })
  it('resolveWeek takes a valid week up to the current one, else the current week', () => {
    expect(resolveWeek('2026-W40', '2026-W45')).toBe('2026-W40')
    expect(resolveWeek('2026-W46', '2026-W45')).toBe('2026-W45') // the future
    expect(resolveWeek('nope', '2026-W45')).toBe('2026-W45')
    expect(resolveWeek(null, '2026-W45')).toBe('2026-W45')
  })
  it('labels the range Monday to Sunday with ISO dates', () => {
    expect(weekRangeLabel('2026-W45')).toBe('2026-11-02 to 2026-11-08')
    expect(weekRangeLabel('2026-W46')).toBe('2026-11-09 to 2026-11-15')
  })
})

describe('fmtHm (hours text)', () => {
  const cases: [number, string][] = [[0, '0 min'], [45, '45 min'], [60, '1 h'], [370, '6 h 10 min'], [465, '7 h 45 min'], [480, '8 h'], [481, '8 h 1 min']]
  for (const [n, s] of cases) it(`${n} -> ${s}`, () => expect(fmtHm(n)).toBe(s))
})

describe('weekSummary on a fixture week (2026-W45, Mon Nov 2 to Sun Nov 8)', () => {
  const sess = (id: string, start: number, minutes: number): Session => ({ id, ticketId: 't', start, end: start + minutes * 60_000, minutes, outcome: 'solved', xpDelta: 0 })
  const done = (id: string, doneAt: number, over = {}) => ({ ...mkTicket({ id, ...over }), status: 'done' as const, doneAt })
  const tickets = [
    done('a', at(2026, 11, 2, 0, 10)), done('b', at(2026, 11, 8, 23, 59)), done('before', at(2026, 11, 1, 23, 50)), done('after', at(2026, 11, 9, 0, 0)),
    { ...done('arch', at(2026, 11, 4, 12)), archived: true },
    done('lab-close', at(2026, 11, 6, 16), { title: 'Lab last step' }), done('lab-old-close', at(2026, 10, 20, 9)),
  ]
  const sessions = [sess('s1', at(2026, 11, 2, 9), 200), sess('s2', at(2026, 11, 8, 22), 170), sess('out', at(2026, 11, 9, 0, 0), 99), sess('early', at(2026, 11, 1, 23, 30), 60)]
  const redo = (id: string, ticketId: string, createdAt: number, source: Redo['source'] = 'journal_hard'): Redo => ({ id, ticketId, source, createdAt, stage: 0, due: createdAt, passed: [], helpCost: 0, refunded: 0 })
  const redos = [redo('jh-a-2026-11-03', 'a', at(2026, 11, 3, 20)), redo('jh-b-2026-11-05', 'b', at(2026, 11, 5, 20)), redo('jh-old', 'a', at(2026, 11, 1, 20)), redo('c1', 'b', at(2026, 11, 4), 'check_failed')]
  const row = (day: string, hardest?: string): JournalRow => ({ id: `journal-${day}`, day, at: 0, mode: 'studied', items: [], ...(hardest ? { hardest } : {}) })
  const journal = [row('2026-11-01', 'old line'), row('2026-11-03', 'Attention masks'), row('2026-11-05', 'Cache invalidation order'), row('2026-11-06'), row('2026-11-09', 'after')]
  const base = { week: '2026-W45', tickets, sessions, redos, journal, labReviews: [], labClosing: {}, budgetMin: 480 }
  const s = weekSummary(base)

  it('lists the non-archived tickets done inside the week, in ascending doneAt', () => {
    expect(s.ticketsDone.map(t => t.id)).toEqual(['a', 'lab-close', 'b'])
  })
  it('minutes studied against the week budget, by session start; no percentage', () => {
    expect(s.minutes).toBe(370)
    expect(s.budgetMin).toBe(480)
    expect(s.timeLine).toBe('6 h 10 min of 8 h')
  })
  it('hard: one row per journal_hard redo created in the week (in time order), then one line per day with a hardest text', () => {
    expect(s.hardRedos).toEqual([{ redoId: 'jh-a-2026-11-03', ticketId: 'a', title: 'a' }, { redoId: 'jh-b-2026-11-05', ticketId: 'b', title: 'b' }])
    expect(s.hardLines).toEqual([{ day: '2026-11-03', text: 'Attention masks' }, { day: '2026-11-05', text: 'Cache invalidation order' }])
  })
  it('labs: Done when the closing ticket was done in the week; Proven when a passing review is in the week (Proven wins)', () => {
    const closing = { 't-lab': 'lab-close', 'old-lab': 'lab-old-close', 'open-lab': 'nope' }
    expect(weekSummary({ ...base, labClosing: closing }).labs).toEqual([{ labId: 't-lab', state: 'done' }])
    const reviews = [{ labId: 't-lab', at: at(2026, 11, 7, 12), passed: true }, { labId: 'x', at: at(2026, 11, 7, 12), passed: false }, { labId: 'old-lab', at: at(2026, 10, 25), passed: true }]
    expect(weekSummary({ ...base, labClosing: closing, labReviews: reviews }).labs).toEqual([{ labId: 't-lab', state: 'proven' }])
  })
  it('an empty week is all zeros and still reads "0 min of 8 h"', () => {
    const e = weekSummary({ ...base, week: '2026-W40' })
    expect(e.ticketsDone).toEqual([])
    expect(e.labs).toEqual([])
    expect(e.hardRedos).toEqual([])
    expect(e.timeLine).toBe('0 min of 8 h')
  })
  it('the budget text follows the budget (465 minutes reads 7 h 45 min)', () => {
    expect(weekSummary({ ...base, budgetMin: 465 }).timeLine).toBe('6 h 10 min of 7 h 45 min')
  })
  it('a session at 23:30 on Sunday belongs to the week it starts in even when it ends after midnight', () => {
    const late = sess('late', at(2026, 11, 8, 23, 30), 60)
    expect(weekSummary({ ...base, sessions: [late] }).minutes).toBe(60)
    expect(weekSummary({ ...base, week: '2026-W46', sessions: [late] }).minutes).toBe(0)
  })
})

describe('the weekly form', () => {
  it('trims, caps the focus to one line of 200, and the text fields to 1000', () => {
    expect(weeklyRow({ worked: ' Short sessions ', change: '', focus: 'Finish\nthe\nroofline' }, '2026-W45', 5)).toEqual({
      id: 'wr-2026-W45', week: '2026-W45', worked: 'Short sessions', change: '', focus: 'Finish the roofline', at: 5,
    })
    expect(weeklyId('2026-W45')).toBe('wr-2026-W45')
    const long = weeklyRow({ worked: 'w'.repeat(1200), change: 'c'.repeat(1200), focus: 'f'.repeat(250) }, '2026-W45', 5)
    expect([long.worked.length, long.change.length, long.focus.length]).toEqual([1000, 1000, 200])
  })
  it('blank means all three fields hold only spaces', () => {
    expect(weeklyBlank(emptyWeeklyForm)).toBe(true)
    expect(weeklyBlank({ worked: '  ', change: '', focus: ' \n ' })).toBe(true)
    expect(weeklyBlank({ worked: '', change: '', focus: 'x' })).toBe(false)
  })
  it('weeklySaved compares the form with the stored row ignoring the save time; a cleared field is a difference', () => {
    const stored = weeklyRow({ worked: 'a', change: 'b', focus: 'c' }, '2026-W44', 5)
    expect(weeklySaved(weeklyFormFromRow(stored), stored)).toBe(true)
    expect(weeklySaved({ ...weeklyFormFromRow(stored), focus: 'd' }, stored)).toBe(false)
    expect(weeklySaved({ ...weeklyFormFromRow(stored), worked: '' }, stored)).toBe(false)
    expect(weeklySaved(emptyWeeklyForm, null)).toBe(false)
  })
})

describe('latestFocus', () => {
  it('is the focus of the greatest week key, hidden (empty) when that review has none; an older week saved later changes nothing', () => {
    expect(latestFocus([])).toBe('')
    expect(latestFocus([{ week: '2026-W44', focus: 'old' }, { week: '2026-W45', focus: ' Finish the roofline ' }])).toBe('Finish the roofline')
    expect(latestFocus([{ week: '2026-W45', focus: '' }, { week: '2026-W44', focus: 'old' }])).toBe('')
    expect(latestFocus([{ week: '2026-W45', focus: 'new' }, { week: '2026-W41', focus: 'older edited later' }])).toBe('new')
  })
})

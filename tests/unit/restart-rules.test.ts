import { describe, expect, it } from 'vitest'
import type { JournalRow, Session } from '../../src/data/types'
import { localDayKey } from '../../src/lib/dates'
import { activeDaysOf, dayBudgets, halfBudget, leadOf, restartState } from '../../src/rules/restart'
import { mkTicket } from '../helpers/planV2'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const days = (...k: string[]) => new Set(k)
const r = (active: Set<string>, today: string) => restartState(active, today)

describe('welcome: 4 or more inactive days and today not yet active', () => {
  // last active day 2026-11-01 (a Sunday)
  const cases: [string, string, boolean][] = [
    ['the day after (0 inactive)', '2026-11-02', false],
    ['2 inactive days', '2026-11-04', false],
    ['3 inactive days', '2026-11-05', false],
    ['4 inactive days (Mon, Tue, Wed, Thu)', '2026-11-06', true],
    ['5 inactive days', '2026-11-07', true],
    ['10 inactive days', '2026-11-12', true],
  ]
  for (const [name, today, want] of cases) it(name, () => expect(r(days('2026-11-01'), today).welcome).toBe(want))
  it('is off once today is active, however long the gap was', () => {
    expect(r(days('2026-11-01', '2026-11-12'), '2026-11-12').welcome).toBe(false)
  })
  it('counts from the latest active day before today, not the first', () => {
    expect(r(days('2026-10-01', '2026-11-04'), '2026-11-06').welcome).toBe(false) // 1 inactive day
  })
  it('a learner with no active day is not "back"', () => {
    expect(r(days(), '2026-11-06')).toEqual({ welcome: false, halfLoad: false })
  })
  it('ignores days after today', () => {
    expect(r(days('2026-11-01', '2026-11-20'), '2026-11-06').welcome).toBe(true)
  })
  it('the contract fixture: last active 2026-10-28; 3 inactive days at 11-01, 4 at 11-02, 6 at 11-04, 10 at 11-08', () => {
    const A = days('2026-10-20', '2026-10-28')
    expect([r(A, '2026-11-01'), r(A, '2026-11-02'), r(A, '2026-11-04'), r(A, '2026-11-08')].map(x => x.welcome)).toEqual([false, true, true, true])
  })
})

describe('half load: the 4 local days after the first active day that ended a run of 4 or more inactive days', () => {
  // active 2026-10-20, then nothing until the return day 2026-11-01 (10 inactive days)
  const A = days('2026-10-20', '2026-11-01')
  const cases: [string, string, boolean][] = [
    ['the return day itself is a normal day', '2026-11-01', false],
    ['day 1 after', '2026-11-02', true],
    ['day 4 after', '2026-11-05', true],
    ['day 5 after is back to normal', '2026-11-06', false],
    ['before the return', '2026-10-25', false],
  ]
  for (const [name, today, want] of cases) it(name, () => expect(r(A, today).halfLoad).toBe(want))
  it('a run of exactly 3 inactive days does not start a window', () => {
    expect(r(days('2026-10-28', '2026-11-01'), '2026-11-02').halfLoad).toBe(false)
  })
  it('a run of exactly 4 inactive days does', () => {
    expect(r(days('2026-10-27', '2026-11-01'), '2026-11-02').halfLoad).toBe(true)
  })
  it('the contract fixture: run ending 11-01, a lone active day 11-03, then 11-05 is the fourth day and 11-06 the fifth', () => {
    const H = days('2026-10-24', '2026-11-01', '2026-11-03')
    expect([r(H, '2026-11-01'), r(H, '2026-11-05'), r(H, '2026-11-06')].map(x => x.halfLoad)).toEqual([false, true, false])
    expect(r(H, '2026-11-05').welcome).toBe(false) // 11-04 is the only inactive day since 11-03
  })
  it('a later short gap does not cancel the window; a later long run replaces it', () => {
    expect(r(days('2026-10-20', '2026-11-01', '2026-11-03'), '2026-11-04').halfLoad).toBe(true)
    expect(r(days('2026-10-20', '2026-11-01', '2026-11-10'), '2026-11-11').halfLoad).toBe(true) // the new return day is 11-10
    expect(r(days('2026-10-20', '2026-11-01', '2026-11-10'), '2026-11-03').halfLoad).toBe(true) // still inside the first window on its own day
  })
  it('a Floor session on a restart day makes it the return day: the next four days are half load (RIT-61)', () => {
    const F = days('2026-10-28', '2026-11-04')
    expect([r(F, '2026-11-04'), r(F, '2026-11-05'), r(F, '2026-11-06'), r(F, '2026-11-08'), r(F, '2026-11-09')].map(x => x.halfLoad)).toEqual([false, true, true, true, false])
    expect(r(F, '2026-11-04').welcome).toBe(false)
  })
  it('welcome and half load are never both on', () => {
    for (let n = 1; n <= 20; n++) {
      const today = localDayKey(at(2026, 11, n))
      const s = r(days('2026-10-20', '2026-11-01'), today)
      expect(s.welcome && s.halfLoad, today).toBe(false)
    }
  })
})

describe('active days', () => {
  const sess = (start: number): Session => ({ id: `s${start}`, ticketId: 't', start, end: start + 60_000, minutes: 1, outcome: 'solved', xpDelta: 0 })
  const jr = (day: string, mode: 'studied' | 'none'): JournalRow => ({ id: `journal-${day}`, day, at: 0, mode, items: [] })
  it('a session, a non-archived ticket moved to Done and a studied Journal row each make a day active', () => {
    const a = activeDaysOf({
      sessions: [sess(at(2026, 11, 1, 9))],
      tickets: [{ ...mkTicket({ id: 'd' }), status: 'done' as const, doneAt: at(2026, 11, 2, 9) }],
      journal: [jr('2026-11-03', 'studied')],
    })
    expect([...a].sort()).toEqual(['2026-11-01', '2026-11-02', '2026-11-03'])
  })
  it('a no-study Journal row, an open ticket and an archived done ticket do not', () => {
    const a = activeDaysOf({
      sessions: [],
      tickets: [mkTicket({ id: 'o', doneAt: at(2026, 11, 2) }), { ...mkTicket({ id: 'ar' }), status: 'done' as const, doneAt: at(2026, 11, 2), archived: true }],
      journal: [jr('2026-11-03', 'none')],
    })
    expect(a.size).toBe(0)
  })
  it('local midnight: a session at 23:59 belongs to that day, one at 00:00 to the next, and the 4-day boundary moves with it', () => {
    const a = activeDaysOf({ sessions: [sess(at(2026, 11, 3, 23, 59)), sess(at(2026, 11, 4, 0, 0))], tickets: [], journal: [] })
    expect([...a].sort()).toEqual(['2026-11-03', '2026-11-04'])
    const one = activeDaysOf({ sessions: [sess(at(2026, 11, 1, 23, 59))], tickets: [], journal: [] })
    expect(r(one, localDayKey(at(2026, 11, 5, 23, 59))).welcome).toBe(false) // 3 inactive days
    expect(r(one, localDayKey(at(2026, 11, 6, 0, 0))).welcome).toBe(true) // 4
  })
})

describe('half the budget, to a multiple of 5 minutes', () => {
  const cases: [number, number][] = [[0, 0], [30, 15], [45, 20], [60, 30], [90, 45], [150, 75], [10, 5], [9, 0]]
  for (const [n, h] of cases) it(`${n} -> ${h}`, () => expect(halfBudget(n)).toBe(h))
  it('dayBudgets halves all seven only while the window is on', () => {
    expect(dayBudgets([90, 60, 60, 60, 30, 30, 150], { welcome: false, halfLoad: true })).toEqual([45, 30, 30, 30, 15, 15, 75])
    expect(dayBudgets([90, 60, 60, 60, 30, 30, 150], { welcome: true, halfLoad: false })).toEqual([90, 60, 60, 60, 30, 30, 150])
  })
})

describe('which lead the Floor takes', () => {
  const cases: [string, boolean, boolean, boolean, string | null][] = [
    ['neither', false, false, false, null],
    ['a restart day', true, false, false, 'restart'],
    ['a short day (the day mix is empty)', false, true, false, 'short'],
    ['a restart day wins over a short day', true, true, false, 'restart'],
    ['a started ticket on a restart day keeps the restart lead (RIT-54)', true, false, true, 'restart'],
    ['a started ticket is never put behind the Floor (short)', false, true, true, null],
  ]
  for (const [name, welcome, floor, resuming, want] of cases) it(name, () => expect(leadOf({ welcome, halfLoad: false }, floor, resuming)).toBe(want))
})

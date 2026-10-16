import { describe, expect, it } from 'vitest'
import {
  bodyOf, DEDICATED_RITUALS, ritualOpen, ritualPeriod, ritualTicket, ritualTicketId, ritualTicketOrigin, type RitualEntry,
} from '../../src/rules/ritualPeriod'
import { weekTicketId } from '../../src/rules/ritual'

// local times: the unit suite runs in TZ=Asia/Kolkata and every helper reads local fields
const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0) => new Date(y, m - 1, d, h, min, s).getTime()
const WR: RitualEntry = { id: 'weekly-review', title: 'Weekly review', cadence: 'weekly', minutes: 60, dueWeekday: 0, dueHour: 12 }
const SWAP: RitualEntry = { id: 'model-swap-drill', title: 'Model swap drill', cadence: 'monthly', minutes: 180, dueWeekday: 6, body: 'Swap a model.' }
const key = (e: RitualEntry, ms: number) => ritualOpen(e, ms)?.key ?? null

describe('weekly review: Sunday 12:00 local to the end of Sunday', () => {
  // 2026-10-18 is a Sunday (ISO week 2026-W42, Monday 2026-10-12)
  const cases: [string, number, string | null][] = [
    ['Saturday 23:59', at(2026, 10, 17, 23, 59), null],
    ['Sunday 00:00', at(2026, 10, 18, 0, 0), null],
    ['Sunday 11:59:59', at(2026, 10, 18, 11, 59, 59), null],
    ['Sunday 12:00:00', at(2026, 10, 18, 12, 0, 0), '2026-W42'],
    ['Sunday 18:30', at(2026, 10, 18, 18, 30), '2026-W42'],
    ['Sunday 23:59:59', at(2026, 10, 18, 23, 59, 59), '2026-W42'],
    ['Monday 00:00 (the card is gone, nothing is missed)', at(2026, 10, 19, 0, 0), null],
    ['Monday noon', at(2026, 10, 19, 12, 0), null],
    ['the next Sunday 12:00', at(2026, 10, 25, 12, 0), '2026-W43'],
    ['year edge: Sunday 2027-01-03 12:00 is week 2026-W53', at(2027, 1, 3, 12, 0), '2026-W53'],
    ['the contract Sunday 2026-11-08: 11:59 absent, 12:00 present', at(2026, 11, 8, 11, 59), null],
    ['the contract Sunday 2026-11-08 12:00', at(2026, 11, 8, 12, 0), '2026-W45'],
  ]
  for (const [name, ms, want] of cases) it(name, () => expect(key(WR, ms)).toBe(want))
  it('an entry with no dueWeekday or dueHour still means Sunday 12:00 (W4 owns the data fields)', () => {
    const bare: RitualEntry = { id: 'weekly-review', title: 'Weekly review', cadence: 'weekly', minutes: 60 }
    expect(key(bare, at(2026, 11, 8, 11, 59))).toBeNull()
    expect(key(bare, at(2026, 11, 8, 12, 0))).toBe('2026-W45')
    expect(key(bare, at(2026, 11, 9, 0, 0))).toBeNull()
  })
})

describe('monthly swap drill: from the first Saturday to the end of the month', () => {
  const cases: [string, number, string | null][] = [
    ['Nov 2026: the 1st is a Sunday, so the first Saturday is the 7th; Nov 6 23:59:59 is too early', at(2026, 11, 6, 23, 59, 59), null],
    ['Wednesday Nov 4 10:00 is too early', at(2026, 11, 4, 10), null],
    ['Nov 7 00:00 opens it (local midnight)', at(2026, 11, 7, 0, 0), '2026-11'],
    ['Nov 14, a second Saturday, is still open', at(2026, 11, 14, 12), '2026-11'],
    ['Nov 30 23:59:59 is the last moment', at(2026, 11, 30, 23, 59, 59), '2026-11'],
    ['Dec 1 00:00 is a new month and the first Saturday is Dec 5', at(2026, 12, 1, 0, 0), null],
    ['Dec 4 23:59 is still too early', at(2026, 12, 4, 23, 59), null],
    ['Dec 5 00:00 opens December', at(2026, 12, 5, 0, 0), '2026-12'],
    ['Aug 2026: the 1st is a Saturday, so it opens at 00:00 on the 1st', at(2026, 8, 1, 0, 0), '2026-08'],
    ['Jul 31 23:59 is still July (opened Jul 4)', at(2026, 7, 31, 23, 59), '2026-07'],
    ['Jan 1 2027 23:59 is too early', at(2027, 1, 1, 23, 59), null],
    ['Jan 2 2027 00:00 opens (the first Saturday is the 2nd)', at(2027, 1, 2, 0, 0), '2027-01'],
    ['Dec 31 2027 23:59: December 2027 opened on Saturday Dec 4, so it is still open (RIT-68; RIT-67 lists this clock as absent, which contradicts the end-of-month rule)', at(2027, 12, 31, 23, 59), '2027-12'],
    ['Jan 1 2028 00:00 (a Saturday) opens', at(2028, 1, 1, 0, 0), '2028-01'],
    ['Wednesday Dec 2 10:00 is too early', at(2026, 12, 2, 10), null],
    ['Saturday Dec 12 10:00 (second Saturday) is open', at(2026, 12, 12, 10), '2026-12'],
  ]
  for (const [name, ms, want] of cases) it(name, () => expect(key(SWAP, ms)).toBe(want))
  it('an entry with no dueWeekday still means the first Saturday', () => {
    const bare: RitualEntry = { id: 'model-swap-drill', title: 'Model swap drill', cadence: 'monthly', minutes: 180 }
    expect(key(bare, at(2026, 11, 6, 23, 59))).toBeNull()
    expect(key(bare, at(2026, 11, 7, 0, 0))).toBe('2026-11')
  })
})

describe('ritualPeriod', () => {
  it('a daily entry has no period', () => {
    expect(ritualPeriod({ id: 'ai-pulse', title: 'p', cadence: 'daily', minutes: 15 }, at(2026, 10, 18))).toBeNull()
  })
  it('a monthly dueHour moves the opening moment within the first such weekday', () => {
    const e = { ...SWAP, dueHour: 9 }
    expect(ritualOpen(e, at(2026, 11, 7, 8, 59))).toBeNull()
    expect(ritualOpen(e, at(2026, 11, 7, 9, 0))?.key).toBe('2026-11')
  })
  it('the weekly period belongs to the ISO week of now, Monday first', () => {
    expect(ritualPeriod(WR, at(2026, 10, 19, 9))?.key).toBe('2026-W43')
    expect(ritualPeriod(WR, at(2026, 10, 18, 9))?.key).toBe('2026-W42')
  })
})

describe('tickets', () => {
  it('ids and origins follow the try-new-model pattern', () => {
    expect(ritualTicketId('weekly-review', '2026-W45')).toBe('ritual-weekly-review-2026-W45')
    expect(ritualTicketId('model-swap-drill', '2026-11')).toBe('ritual-model-swap-drill-2026-11')
    expect(ritualTicketOrigin('model-swap-drill', '2026-11')).toBe('ritual:model-swap-drill:2026-11')
    expect(ritualTicketId('try-new-model', '2026-W42')).toBe(weekTicketId(at(2026, 10, 14)))
  })
  it('mints a ritual-kind, ritual-lane, todo ticket with the entry body and minutes', () => {
    const now = at(2026, 11, 7, 10)
    const t = ritualTicket(SWAP, ritualOpen(SWAP, now)!, now)
    expect(t).toMatchObject({ id: 'ritual-model-swap-drill-2026-11', origin: 'ritual:model-swap-drill:2026-11', kind: 'ritual', lane: 'ritual', title: 'Model swap drill', text: 'Swap a model.', estMin: 180, status: 'todo', xp: 0, archived: false })
  })
  it('without a body the two known rituals use the contract text exactly; an unknown one gets none', () => {
    expect(bodyOf(WR)).toBe('Look back at your week, then write three short lines: what worked, what to change, and a focus for next week.')
    expect(bodyOf({ ...SWAP, body: undefined })).toBe('Pick a lab you have done. Swap the model it uses, then measure again. Write the before and after numbers in a Pulse or Journal line.')
    expect(bodyOf({ id: 'x', title: 'x', cadence: 'weekly', minutes: 5 })).toBe('')
  })
  it('the dedicated list names the three rituals with their own card', () => {
    expect([...DEDICATED_RITUALS]).toEqual(['try-new-model', 'weekly-review', 'model-swap-drill'])
  })
})

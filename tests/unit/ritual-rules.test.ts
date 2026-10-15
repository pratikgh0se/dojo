// F1 Today ritual column: the pure rules (ISO week, week strip, pulse copy, the week ticket).
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DUE_WEEKDAY, DEFAULT_TRY_MINUTES, PULSE_MAX, checkPulseText, isoWeekOf, pulseId, pulseWhen,
  tryModelBody, tryModelPhoneBody, weekStrip, weekTicket, weekTicketId, weekdayName,
} from '../../src/rules/ritual'
import { isBankOrigin, isOffPlanOrigin, isRitualOrigin } from '../../src/rules/bankTickets'

// local times: the unit suite runs in TZ=Asia/Kolkata, and every helper here reads local fields
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()

describe('isoWeekOf', () => {
  it('gives the ISO year and week of a local day', () => {
    expect(isoWeekOf(at(2026, 10, 12)).key).toBe('2026-W42') // a Monday
    expect(isoWeekOf(at(2026, 10, 18, 23, 59)).key).toBe('2026-W42') // the Sunday of that week
    expect(isoWeekOf(at(2026, 10, 19)).key).toBe('2026-W43')
  })
  it('handles the year edges (ISO week 53 and week 1 of the next year)', () => {
    expect(isoWeekOf(at(2026, 12, 31)).key).toBe('2026-W53')
    expect(isoWeekOf(at(2027, 1, 3)).key).toBe('2026-W53')
    expect(isoWeekOf(at(2027, 1, 4)).key).toBe('2027-W01')
    expect(isoWeekOf(at(2024, 12, 30)).key).toBe('2025-W01')
  })
  it('pads the week to two digits', () => {
    expect(isoWeekOf(at(2026, 1, 5)).key).toBe('2026-W02')
  })
})

describe('weekTicketId', () => {
  it('is ritual-try-new-model-<year>-W<ww>', () => {
    expect(weekTicketId(at(2026, 10, 14))).toBe('ritual-try-new-model-2026-W42')
  })
})

describe('weekStrip', () => {
  // Monday 2026-10-12 is day index 0; due Saturday is weekday 6 (Sunday = 0) = cell 5
  const states = (nowMs: number, doneAt?: number, due = DEFAULT_DUE_WEEKDAY) => weekStrip({ nowMs, dueWeekday: due, doneAt }).map(c => c.state)
  it('has seven cells, Monday first, with the letters M T W T F S S', () => {
    expect(weekStrip({ nowMs: at(2026, 10, 12), dueWeekday: 6 }).map(c => c.letter).join('')).toBe('MTWTFSS')
  })
  it('on Monday: today, due Saturday, nothing else', () => {
    expect(states(at(2026, 10, 12))).toEqual(['today', '', '', '', '', 'due', ''])
  })
  it('on Wednesday: Monday and Tuesday are past', () => {
    expect(states(at(2026, 10, 14))).toEqual(['past', 'past', 'today', '', '', 'due', ''])
  })
  it('on the due day, due wins and the cell is also today', () => {
    const cells = weekStrip({ nowMs: at(2026, 10, 17), dueWeekday: 6 })
    expect(cells.map(c => c.state)).toEqual(['past', 'past', 'past', 'past', 'past', 'due', ''])
    expect(cells.map(c => c.today)).toEqual([false, false, false, false, false, true, false])
  })
  it('on Sunday after the due day: the due cell stays due, the rest before today are past', () => {
    expect(states(at(2026, 10, 18))).toEqual(['past', 'past', 'past', 'past', 'past', 'due', 'today'])
  })
  it('the day the run was marked done is done, and wins over today and due', () => {
    expect(states(at(2026, 10, 14), at(2026, 10, 13))).toEqual(['past', 'done', 'today', '', '', 'due', ''])
    expect(states(at(2026, 10, 14), at(2026, 10, 14))).toEqual(['past', 'past', 'done', '', '', 'due', ''])
    expect(states(at(2026, 10, 17), at(2026, 10, 17))[5]).toBe('done')
  })
  it('a done time outside this week marks nothing', () => {
    expect(states(at(2026, 10, 14), at(2026, 10, 8))).toEqual(['past', 'past', 'today', '', '', 'due', ''])
  })
  it('the due weekday moves the due cell (Sunday = 0 is the last cell)', () => {
    expect(states(at(2026, 10, 12), undefined, 0)[6]).toBe('due')
    expect(states(at(2026, 10, 12), undefined, 1)).toEqual(['due', '', '', '', '', '', ''].map((s, i) => (i === 0 ? 'due' : s)))
  })
})

describe('pulseWhen', () => {
  it('names the part of the local day', () => {
    expect(pulseWhen(at(2026, 10, 12, 9, 10))).toBe('Logged this morning')
    expect(pulseWhen(at(2026, 10, 12, 11, 59))).toBe('Logged this morning')
    expect(pulseWhen(at(2026, 10, 12, 12, 0))).toBe('Logged this afternoon')
    expect(pulseWhen(at(2026, 10, 12, 16, 59))).toBe('Logged this afternoon')
    expect(pulseWhen(at(2026, 10, 12, 17, 0))).toBe('Logged this evening')
    expect(pulseWhen(at(2026, 10, 12, 23, 30))).toBe('Logged this evening')
  })
})

describe('pulse text', () => {
  it('trims and refuses blank text', () => {
    expect(checkPulseText('  Asked Claude  ')).toEqual({ ok: true, text: 'Asked Claude' })
    expect(checkPulseText('   ').ok).toBe(false)
    expect(checkPulseText('').ok).toBe(false)
  })
  it('allows 140 characters and refuses 141', () => {
    expect(PULSE_MAX).toBe(140)
    expect(checkPulseText('a'.repeat(140)).ok).toBe(true)
    expect(checkPulseText('a'.repeat(141)).ok).toBe(false)
  })
  it('keys the row by local day', () => {
    expect(pulseId('2026-10-12')).toBe('pulse-2026-10-12')
  })
})

describe('copy', () => {
  it('names the weekday, Sunday first', () => {
    expect(weekdayName(6)).toBe('Saturday')
    expect(weekdayName(0)).toBe('Sunday')
  })
  it('the desktop body and the phone body carry the minutes and the due day', () => {
    expect(tryModelBody(30, 6)).toBe('Run one small open model, then note its tokens per second and what limited it. 30 minutes, any day before Saturday.')
    expect(tryModelPhoneBody(6)).toBe('Due Saturday. Run one small open model and note tokens per second.')
    expect(DEFAULT_TRY_MINUTES).toBe(30)
  })
})

describe('weekTicket', () => {
  it('is a todo ritual ticket for the ISO week, with the desktop copy as its text', () => {
    const t = weekTicket(at(2026, 10, 14), { minutes: 30, dueWeekday: 6 })
    expect(t).toMatchObject({
      id: 'ritual-try-new-model-2026-W42', kind: 'ritual', lane: 'ritual', origin: 'ritual:try-new-model:2026-W42',
      title: 'Try a model', estMin: 30, status: 'todo', archived: false,
      text: tryModelBody(30, 6),
    })
    expect(t.xp).toBe(0) // XP is paid by Done (TICKET-11), as on every plan ticket
    expect(t.links).toEqual([])
  })
})

describe('origins', () => {
  it('a ritual origin is its own kind: not a bank origin, and off the plan', () => {
    expect(isRitualOrigin('ritual:try-new-model:2026-W42')).toBe(true)
    expect(isRitualOrigin('plan')).toBe(false)
    expect(isRitualOrigin(undefined)).toBe(false)
    expect(isBankOrigin('ritual:try-new-model:2026-W42')).toBe(false)
    expect(isOffPlanOrigin('ritual:try-new-model:2026-W42')).toBe(true)
    expect(isOffPlanOrigin('bank:blind75')).toBe(true)
    expect(isOffPlanOrigin('mine')).toBe(true)
    expect(isOffPlanOrigin('plan')).toBe(false)
  })
})

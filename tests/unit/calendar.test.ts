import { describe, expect, it } from 'vitest'
import { activityByDay, calendarChartData, calendarGrid, calendarTotal, streak } from '../../src/rules/calendar'
import type { Session } from '../../src/data/types'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const session = (ticketId: string, start: string, end: string): Session => ({
  id: `s-${ticketId}`, ticketId, start: ist(start), end: ist(end), minutes: 50, outcome: 'solved', xpDelta: 10,
})

describe('activityByDay', () => {
  it('counts a midnight-crossing session on its start day only (Review Focus #3)', () => {
    const s = session('a', '2026-09-20T23:40:00', '2026-09-21T00:30:00')
    const a = mkTicket({ id: 'a', status: 'done', doneAt: ist('2026-09-21T00:30:00'), xp: 10 })
    const act = activityByDay([a], [s])
    expect(Object.fromEntries(act)).toEqual({ '2026-09-20': 1 })
  })
  it('counts Board-done tickets without a session on doneAt; ignores todo and reserved approx rows', () => {
    const act = activityByDay(
      [
        mkTicket({ id: 'b', status: 'done', doneAt: ist('2026-09-22T10:00:00') }),
        mkTicket({ id: 'c', status: 'done', doneAt: ist('2026-09-22T11:00:00'), doneAtApprox: true }),
        mkTicket({ id: 'd' }),
      ],
      [],
    )
    expect(Object.fromEntries(act)).toEqual({ '2026-09-22': 1 })
  })
})

describe('calendarGrid', () => {
  it('ends with the current Sunday-first week (a Sunday is the last week\'s first row)', () => {
    const g = calendarGrid(new Map(), ist('2026-09-27T10:00:00')) // a Sunday
    expect(g.weeks).toHaveLength(8)
    expect(g.weeks.every(w => w.length === 7)).toBe(true)
    expect(g.weeks[0][0].key).toBe('2026-08-09')
    expect(g.weeks[7][0]).toEqual({ key: '2026-09-27', count: 0, future: false })
    expect(g.weeks[7][1]).toMatchObject({ key: '2026-09-28', future: true })
    expect(g.months).toEqual([['AUG', 0], ['SEP', 7]])
  })
  it('puts Monday, Wednesday and Friday on rows 1, 3 and 5, where the engine draws its M, W and F (cu-2 P3-3)', () => {
    const g = calendarGrid(new Map(), ist('2026-09-23T10:00:00'))
    const dow = (key: string) => new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })
    for (const w of g.weeks) expect([1, 3, 5].map(r => dow(w[r].key))).toEqual(['Mon', 'Wed', 'Fri'])
    expect(g.weeks.map(w => dow(w[0].key))).toEqual(Array(8).fill('Sun'))
  })
  it('marks days after today as future and fills counts', () => {
    const g = calendarGrid(new Map([['2026-09-22', 2]]), ist('2026-09-23T10:00:00'))
    expect(g.weeks[7][2]).toEqual({ key: '2026-09-22', count: 2, future: false })
    expect(g.weeks[7][3].future).toBe(false)
    expect(g.weeks[7][4]).toMatchObject({ key: '2026-09-24', future: true })
  })
})

describe('activityByDay · sessions ≥ 10 min (PLATFORM Today)', () => {
  const s = (ticketId: string, start: string, minutes: number): Session => ({
    id: `s-${ticketId}-${minutes}`, ticketId, start: ist(start), end: ist(start) + minutes * 60_000, minutes,
    outcome: 'gave_up', xpDelta: 0,
  })
  it('ignores a 3-minute session and counts a 10-minute one', () => {
    const act = activityByDay([], [s('a', '2026-10-05T21:10:00', 3), s('b', '2026-10-06T21:10:00', 10)])
    expect(Object.fromEntries(act)).toEqual({ '2026-10-06': 1 })
  })
  it('a done ticket whose only session was short still counts its tick', () => {
    const t = mkTicket({ id: 'a', status: 'done', doneAt: ist('2026-10-05T21:15:00') })
    expect(Object.fromEntries(activityByDay([t], [s('a', '2026-10-05T21:10:00', 5)]))).toEqual({ '2026-10-05': 1 })
  })
  it('a qualifying session replaces its ticket tick (no double count)', () => {
    const t = mkTicket({ id: 'a', status: 'done', doneAt: ist('2026-10-05T21:40:00') })
    expect(Object.fromEntries(activityByDay([t], [s('a', '2026-10-05T21:10:00', 30)]))).toEqual({ '2026-10-05': 1 })
  })
  it('a ticket with a qualifying session on one day and doneAt on a later day counts on both days', () => {
    const t = mkTicket({ id: 'a', status: 'done', doneAt: ist('2026-10-06T09:00:00') })
    expect(Object.fromEntries(activityByDay([t], [s('a', '2026-10-05T21:10:00', 30)]))).toEqual({
      '2026-10-05': 1,
      '2026-10-06': 1,
    })
  })
})

describe('calendarTotal and calendarChartData (sr-chart calendar)', () => {
  it('sums past counts and maps future days to null', () => {
    const g = calendarGrid(new Map([['2026-09-22', 2], ['2026-09-21', 1]]), ist('2026-09-23T10:00:00'))
    expect(calendarTotal(g)).toBe(3)
    const d = calendarChartData(g)
    expect(d.months).toEqual(g.months)
    expect(d.weeks[7].slice(1, 5)).toEqual([1, 2, 0, null])
    expect(d.weeks).toHaveLength(8)
  })
})

describe('streak', () => {
  const now = ist('2026-09-27T10:00:00')
  it('counts back from today', () => {
    expect(streak(new Map([['2026-09-25', 1], ['2026-09-26', 1], ['2026-09-27', 2]]), now)).toBe(3)
  })
  it('counts back from yesterday when today is still empty', () => {
    expect(streak(new Map([['2026-09-25', 1], ['2026-09-26', 1]]), now)).toBe(2)
  })
  it('breaks on a gap', () => {
    expect(streak(new Map([['2026-09-24', 1], ['2026-09-26', 1]]), now)).toBe(1)
    expect(streak(new Map(), now)).toBe(0)
  })
})

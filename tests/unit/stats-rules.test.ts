import { describe, expect, it } from 'vitest'
import type { Session } from '../../src/data/types'
import { laneMinutes, paceText, planMinutes, recentMinutes, WINDOW_DAYS } from '../../src/rules/stats'
import { laneOf, tagLane } from '../../src/rules/ticketMeta'
import { mkTicket } from '../helpers/planV2'

describe('stats', () => {
  const t = [
    mkTicket({ id: 'a', estMin: 30, status: 'done' }), mkTicket({ id: 'b', estMin: 60 }), mkTicket({ id: 'c', lane: 'dsa', estMin: 20, status: 'done' }),
    mkTicket({ id: 'x', estMin: 99, archived: true }),
  ]
  it('weights minutes by estimate and skips archived tickets', () => {
    expect(planMinutes(t)).toEqual({ done: 50, total: 110 })
    const rows = laneMinutes(t, tagLane)
    expect(rows.map(r => r.lane)).toEqual(['path', 'dsa', 'design'])
    expect(rows[0].minutes).toEqual({ done: 30, total: 90 })
    expect(rows[2].minutes).toEqual({ done: 0, total: 0 })
  })
  it('folds bank tickets into the DSA row and never shows a bank row (README lane tag)', () => {
    const bank = mkTicket({ id: 'bk', lane: 'bank', origin: 'bank', kind: 'problem', estMin: 25, status: 'done' })
    for (const of of [tagLane, laneOf]) {
      const rows = laneMinutes([...t, bank], of)
      expect(rows.map(r => r.lane)).not.toContain('bank')
      expect(rows.find(r => r.lane === 'dsa')!.minutes).toEqual({ done: 45, total: 45 })
    }
    const all = laneMinutes([...t, bank], tagLane)
    expect(all.reduce((n, r) => n + r.minutes.total, 0)).toBe(planMinutes([...t, bank]).total)
  })
  it('adds Career and Ritual rows only when such tickets exist, and the rows add up to the total', () => {
    expect(laneMinutes(t, tagLane).map(r => r.lane)).toEqual(['path', 'dsa', 'design'])
    const more = [...t, mkTicket({ id: 'k', lane: 'career', estMin: 15 }), mkTicket({ id: 'r', lane: 'ritual', kind: 'ritual', estMin: 5, status: 'done' })]
    const rows = laneMinutes(more, tagLane)
    expect(rows.map(r => r.lane)).toEqual(['path', 'dsa', 'design', 'career', 'ritual'])
    expect(rows.reduce((n, r) => n + r.minutes.total, 0)).toBe(planMinutes(more).total)
    expect(rows.reduce((n, r) => n + r.minutes.done, 0)).toBe(planMinutes(more).done)
  })
  it('sums session minutes by start in the last 14 days, not later than now', () => {
    const now = new Date(2026, 10, 4, 10).getTime()
    const s = (id: string, daysAgo: number, minutes: number): Session => ({ id, ticketId: 'a', start: now - daysAgo * 86_400_000, end: now, minutes, outcome: 'solved', xpDelta: 0 })
    expect(recentMinutes([s('1', 1, 30), s('2', 13, 20), s('3', 15, 99)], now)).toBe(50)
    expect(recentMinutes([s('4', 14, 11), s('5', 14.01, 7)], now)).toBe(11) // exactly 14 x 24 h back is inside
    expect(recentMinutes([s('6', -1, 40)], now)).toBe(0) // after the clock
    expect(recentMinutes([], now)).toBe(0)
    // the window follows `start`, not `end`
    expect(recentMinutes([{ ...s('7', 20, 30), end: now }], now)).toBe(0)
  })
  it('writes the pace line with no trailing full stop, no verdict (SKILLS-25)', () => {
    expect(WINDOW_DAYS).toBe(14)
    expect(paceText(50, 960)).toBe('50 of 960 min in the last 14 days')
    expect(paceText(0, 960)).toBe('0 of 960 min in the last 14 days')
    expect(paceText(2000, 960)).not.toMatch(/behind|late|overdue|missed|[.]$/i)
  })
})

import { describe, expect, it } from 'vitest'
import {
  addLocalDays, isIsoDate, localDayKey, localDaysBetween, parseLocalDate, startOfLocalDay, weekdayOf,
} from '../../src/lib/dates'
import { now, resetNow, setNow } from '../../src/lib/clock'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()

describe('dates (local midnight, Asia/Kolkata)', () => {
  it('parses YYYY-MM-DD as local midnight, not UTC', () => {
    expect(parseLocalDate('2026-09-07')).toBe(ist('2026-09-07T00:00:00'))
  })
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-09-07')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('07-09-2026')).toBe(false)
    expect(isIsoDate(20260907)).toBe(false)
    expect(() => parseLocalDate('nope')).toThrow('Invalid date')
  })
  it('counts calendar days across local midnight', () => {
    const start = parseLocalDate('2026-09-07')
    expect(localDaysBetween(start, ist('2026-09-07T23:59:00'))).toBe(0)
    expect(localDaysBetween(start, ist('2026-09-08T00:00:00'))).toBe(1)
    expect(localDaysBetween(start, ist('2026-09-06T23:59:00'))).toBe(-1)
  })
  it('keys days by local date', () => {
    expect(localDayKey(ist('2026-09-20T23:59:00'))).toBe('2026-09-20')
    expect(localDayKey(Date.parse('2026-09-20T18:30:00Z'))).toBe('2026-09-21')
    expect(startOfLocalDay(ist('2026-09-20T15:00:00'))).toBe(ist('2026-09-20T00:00:00'))
    expect(addLocalDays(parseLocalDate('2026-09-07'), 14)).toBe(ist('2026-09-21T00:00:00'))
  })
  it('names weekdays Monday-first', () => {
    expect(weekdayOf(ist('2026-09-07T10:00:00'))).toBe('Mon')
    expect(weekdayOf(ist('2026-09-11T10:00:00'))).toBe('Fri')
    expect(weekdayOf(ist('2026-09-13T10:00:00'))).toBe('Sun')
  })
  it('lets tests pin the clock', () => {
    setNow(() => 42)
    expect(now()).toBe(42)
    resetNow()
    expect(Math.abs(now() - Date.now())).toBeLessThan(1000)
  })
})

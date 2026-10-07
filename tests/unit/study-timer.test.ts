import { describe, expect, it } from 'vitest'
import { newCycle, cycleElapsedMs } from '../../src/lib/cycle'
import { applyAdvance, blockTimer, sessionLabel } from '../../src/lib/studyTimer'
import { advance, startStudy } from '../../src/rules/studySession'
import { loadStudy, saveStudy, clearStudy, loadChimePref, saveChimePref, STUDY_KEY } from '../../src/lib/studyStore'
import { timerView } from '../../src/lib/timer'

const MIN = 60_000
const T0 = new Date('2026-10-06T09:00:00+05:30').getTime()
const study = () => startStudy({ id: 'st1', ticketId: 't1', goal: '', cardIds: ['t1'], focusMin: 25, breakMin: 5, chime: true, now: T0 })
const cyc = () => newCycle({ ticketId: 't1', now: T0 - MIN, redo: null, netAtStart: 0, timer: null })

function memStore() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

describe('blockTimer', () => {
  it('a focus block is a running legacy timer over the same window, keyed to the session start', () => {
    const t = blockTimer(study(), T0, T0 + 25 * MIN, true)
    expect(t).toMatchObject({ ticketId: 't1', sessionStart: T0, start: T0, end: T0 + 25 * MIN, min: 25, running: true, notified: false })
    expect(timerView(t, T0 + 5 * MIN).mmss).toBe('20:00')
  })
})

describe('applyAdvance', () => {
  it('banks each finished focus block into the attempt cycle exactly once', () => {
    const c = cyc()
    const r = advance(study(), T0 + 30 * MIN)
    const out = applyAdvance(c, study(), r, T0 + 30 * MIN)
    expect(out.cycle && cycleElapsedMs(out.cycle, out.timer, T0 + 30 * MIN)).toBe(25 * MIN)
    // running the same advance result again banks nothing more
    const again = applyAdvance(out.cycle, study(), r, T0 + 30 * MIN)
    expect(again.cycle && cycleElapsedMs(again.cycle, again.timer, T0 + 30 * MIN)).toBe(25 * MIN)
  })
  it('a new focus block gets a running timer over its own window; a break stops the legacy timer', () => {
    const inBreak = applyAdvance(cyc(), study(), advance(study(), T0 + 26 * MIN), T0 + 26 * MIN)
    expect(inBreak.timer).toMatchObject({ running: false, notified: true })
    const brk = advance(study(), T0 + 26 * MIN).study
    const r = advance(brk, T0 + 31 * MIN)
    const inFocus = applyAdvance(cyc(), brk, r, T0 + 31 * MIN)
    expect(inFocus.timer).toMatchObject({ running: true, start: T0 + 30 * MIN, end: T0 + 55 * MIN, min: 25 })
  })
  it('a sleep gap banks only the running block (attempt time for the Hint unlock) and stops the timer', () => {
    const r = advance(study(), T0 + 95 * MIN)
    const out = applyAdvance(cyc(), study(), r, T0 + 95 * MIN)
    expect(out.cycle && cycleElapsedMs(out.cycle, out.timer, T0 + 95 * MIN)).toBe(25 * MIN)
    expect(out.timer).toMatchObject({ running: false })
  })
  it('leaves the cycle alone when nothing switched', () => {
    const c = cyc()
    const out = applyAdvance(c, study(), advance(study(), T0 + 3 * MIN), T0 + 3 * MIN)
    expect(out.cycle).toBe(c)
    expect(out.timer).toBeNull()
  })
})

describe('sessionLabel', () => {
  it('reads mm:ss remaining of the current phase', () => {
    expect(sessionLabel(study(), T0 + 5 * MIN + 30_000)).toBe('19:30')
    expect(sessionLabel(study(), T0 + 26 * MIN)).toBe('00:00')
  })
})

describe('studyStore', () => {
  it('round-trips the session, rejects junk, clears', () => {
    const s = memStore()
    expect(loadStudy(s)).toBeNull()
    saveStudy(study(), s)
    expect(loadStudy(s)).toEqual(study())
    s.setItem(STUDY_KEY, '{"nope":1}')
    expect(loadStudy(s)).toBeNull()
    saveStudy(study(), s)
    clearStudy(s)
    expect(loadStudy(s)).toBeNull()
  })
  it('the chime preference defaults on and persists', () => {
    const s = memStore()
    expect(loadChimePref(s)).toBe(true)
    saveChimePref(false, s)
    expect(loadChimePref(s)).toBe(false)
  })
})

import { notifyStudy, subscribeStudy, updateStudy } from '../../src/lib/studyStore'
import { beforeEach, vi } from 'vitest'

describe('updateStudy (single source of truth, no stale writes)', () => {
  beforeEach(() => localStorage.clear())
  it('applies fn to the FRESH stored session and notifies', () => {
    const s = memStore()
    saveStudy(study(), s)
    const out = updateStudy(cur => ({ ...cur, progress: true }), s)
    expect(out).toMatchObject({ progress: true })
    expect(loadStudy(s)).toMatchObject({ progress: true })
  })
  it('drops a write when the session is gone (ended in another tab): it never comes back', () => {
    const s = memStore()
    saveStudy(study(), s)
    clearStudy(s)
    expect(updateStudy(cur => ({ ...cur, progress: true }), s)).toBeUndefined()
    expect(loadStudy(s)).toBeNull()
  })
  it('null ends it', () => {
    const s = memStore()
    saveStudy(study(), s)
    expect(updateStudy(() => null, s)).toBeNull()
    expect(loadStudy(s)).toBeNull()
  })
  it('subscribers hear notifyStudy and storage events for the session, timer and cycle keys', () => {
    const cb = vi.fn()
    const off = subscribeStudy(cb)
    notifyStudy()
    window.dispatchEvent(new StorageEvent('storage', { key: STUDY_KEY }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'dojo-timer' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'dojo-cycle:t1' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }))
    expect(cb).toHaveBeenCalledTimes(4)
    off()
    notifyStudy()
    expect(cb).toHaveBeenCalledTimes(4)
  })
})

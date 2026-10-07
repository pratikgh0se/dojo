import { describe, expect, it } from 'vitest'
import {
  blockingTimerTicketId, clearTimer, clockLabel, drainBlocks, isDone, loadTimer, pauseTimer, saveTimer, startTimer, stopTimer, timerView, TIMER_KEY,
} from '../../src/lib/timer'
import { clearDraft, closingNotes, EMPTY_DRAFT, isEmptyDraft, loadDraft, saveDraft } from '../../src/lib/drafts'

const T = Date.parse('2026-09-14T21:10:00+05:30')
const MIN = 60_000
const ist = (s: string) => new Date(`${s}+05:30`).getTime()

describe('timer (Review Focus #3)', () => {
  it('starts a fresh session', () => {
    expect(startTimer(null, 'p127', 25, T)).toEqual({
      ticketId: 'p127', sessionStart: T, start: T, end: T + 25 * MIN, min: 25, running: true, notified: false,
    })
  })
  it('keeps the session start across restarts of the same ticket, not another', () => {
    const first = stopTimer(startTimer(null, 'p127', 25, T))
    expect(startTimer(first, 'p127', 50, T + 30 * MIN).sessionStart).toBe(T)
    expect(startTimer(first, 'p200', 50, T + 30 * MIN).sessionStart).toBe(T + 30 * MIN)
  })
  it('survives a reload through localStorage', () => {
    const t = startTimer(null, 'p127', 25, T)
    saveTimer(t)
    const reloaded = loadTimer()
    expect(reloaded).toEqual(t)
    expect(timerView(reloaded, T + 5 * MIN)).toEqual({ running: true, remainingMs: 20 * MIN, mmss: '20:00', blocksOn: 4, expired: false, paused: false, done: false })
    clearTimer()
    expect(loadTimer()).toBeNull()
  })
  it('ignores corrupt or wrong-shaped stored timers', () => {
    localStorage.setItem(TIMER_KEY, '{nope')
    expect(loadTimer()).toBeNull()
    localStorage.setItem(TIMER_KEY, JSON.stringify({ ticketId: 'x', start: 'soon' }))
    expect(loadTimer()).toBeNull()
  })
  it('drains five blocks and expires at zero', () => {
    const t = startTimer(null, 'p127', 25, T)
    expect(timerView(t, T)).toMatchObject({ mmss: '25:00', blocksOn: 5 })
    expect(timerView(t, T + 7.5 * MIN)).toMatchObject({ mmss: '17:30', blocksOn: 4 })
    expect(timerView(t, T + 26 * MIN)).toEqual({ running: true, remainingMs: 0, mmss: '00:00', blocksOn: 0, expired: true, paused: false, done: false })
  })
  it('shows --:-- when stopped or absent', () => {
    expect(timerView(null, T).mmss).toBe('--:--')
    expect(timerView(stopTimer(startTimer(null, 'a', 25, T)), T)).toMatchObject({ running: false, mmss: '--:--' })
  })
  it('a run that ended on its own (stopped and noted) reads done at 00:00; a merely stopped or paused one does not (cu-2 P3-6)', () => {
    const ended = { ...stopTimer(startTimer(null, 'a', 25, T)), notified: true }
    expect(isDone(ended)).toBe(true)
    expect(timerView(ended, T + 26 * MIN)).toMatchObject({ running: false, mmss: '00:00', done: true, paused: false })
    expect(isDone(stopTimer(startTimer(null, 'a', 25, T)))).toBe(false)
    expect(timerView(null, T).done).toBe(false)
    expect(timerView(pauseTimer(startTimer(null, 'a', 25, T), T + MIN), T + 2 * MIN).done).toBe(false)
  })
  it('starts a fresh session for the same ticket on a new local day, once stopped (N1)', () => {
    const day1 = ist('2026-09-14T21:10:00')
    const day2 = ist('2026-09-15T09:00:00')
    const stopped = stopTimer(startTimer(null, 'p127', 25, day1))
    expect(startTimer(stopped, 'p127', 25, day2).sessionStart).toBe(day2)
  })
  it('keeps the session start across days for the same ticket while still running (N1)', () => {
    const day1 = ist('2026-09-14T21:10:00')
    const day2 = ist('2026-09-15T09:00:00')
    const running = startTimer(null, 'p127', 25, day1)
    expect(startTimer(running, 'p127', 50, day2).sessionStart).toBe(day1)
  })
  it('blocks starting a running timer for a different ticket, single key (Important #2)', () => {
    const running = startTimer(null, 'p127', 25, T)
    expect(blockingTimerTicketId(running, 'p200')).toBe('p127')
    expect(blockingTimerTicketId(running, 'p127')).toBeNull()
    expect(blockingTimerTicketId(stopTimer(running), 'p200')).toBeNull()
    expect(blockingTimerTicketId(null, 'p200')).toBeNull()
  })
})

describe('drafts', () => {
  it('round-trips and clears per ticket', () => {
    expect(loadDraft('p127')).toEqual(EMPTY_DRAFT)
    saveDraft('p127', { notes: 'BFS from every gate', repo: '', note: '', sessionNotes: '' })
    expect(loadDraft('p127').notes).toBe('BFS from every gate')
    expect(loadDraft('p200')).toEqual(EMPTY_DRAFT)
    clearDraft('p127')
    expect(loadDraft('p127')).toEqual(EMPTY_DRAFT)
  })
  it('keeps the study session Notes apart from the Attempt log, and reads a draft saved before they were two (UAT cu-4 P3-10)', () => {
    saveDraft('p127', { notes: 'invariant: window sum', repo: '', note: '', sessionNotes: 'ch1: slope of a secant' })
    expect(loadDraft('p127')).toMatchObject({ notes: 'invariant: window sum', sessionNotes: 'ch1: slope of a secant' })
    localStorage.setItem('dojo-draft:old', JSON.stringify({ notes: 'older', repo: '', note: '' }))
    expect(loadDraft('old')).toEqual({ notes: 'older', repo: '', note: '', sessionNotes: '' })
    expect(isEmptyDraft({ ...EMPTY_DRAFT, sessionNotes: 'x' })).toBe(false)
    expect(isEmptyDraft(EMPTY_DRAFT)).toBe(true)
  })
  it('closingNotes: the Attempt log, then the session Notes under their own heading; an AI card keeps its Proof', () => {
    const d = { ...EMPTY_DRAFT, notes: 'two pointers', note: 'ran, 3 ms', sessionNotes: 'watched ch1' }
    expect(closingNotes(d, false)).toBe('two pointers\n\nStudy session notes:\nwatched ch1')
    expect(closingNotes(d, true)).toBe('ran, 3 ms\n\nStudy session notes:\nwatched ch1')
    expect(closingNotes({ ...d, sessionNotes: '  ' }, false)).toBe('two pointers')
    expect(closingNotes({ ...d, notes: '' }, false)).toBe('watched ch1')
  })
  it('tolerates corrupt drafts', () => {
    localStorage.setItem('dojo-draft:x', 'nope')
    expect(loadDraft('x')).toEqual(EMPTY_DRAFT)
  })
})

describe('drainBlocks (prototype timer.blocks)', () => {
  it('first block half-lit at start, drains left to right', () => {
    expect(drainBlocks(25 * 60_000, 25 * 60_000)).toEqual(['draining', 'full', 'full', 'full', 'full'])
    expect(drainBlocks(20 * 60_000, 25 * 60_000)).toEqual(['empty', 'draining', 'full', 'full', 'full'])
    expect(drainBlocks(1_000, 25 * 60_000)).toEqual(['empty', 'empty', 'empty', 'empty', 'draining'])
  })
})

describe('clockLabel', () => {
  it('formats local 24h HH:MM', () => {
    expect(clockLabel(new Date('2026-10-05T21:35:00+05:30').getTime())).toBe('21:35')
    expect(clockLabel(new Date('2026-10-05T09:05:00+05:30').getTime())).toBe('09:05')
  })
})

describe('blockingTimerTicketId and a study session on another card', () => {
  it('blocks a plain timer on card B while card A has a study session, even during its breaks', () => {
    localStorage.setItem('dojo-study', JSON.stringify({ ticketId: 'A' }))
    expect(blockingTimerTicketId(null, 'B')).toBe('A')
    expect(blockingTimerTicketId(null, 'A')).toBeNull()
    localStorage.removeItem('dojo-study')
    expect(blockingTimerTicketId(null, 'B')).toBeNull()
  })
})

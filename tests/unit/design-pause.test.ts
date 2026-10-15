import { describe, expect, it } from 'vitest'
import { applyPause, applyResume, clockText, gradedText, isOverdue, lockAt, lockReason, remainingMs, SESSION_MS } from '../../src/rules/designSession'
import { emptyNotes, noteLines, sectionCount, setNoteText } from '../../src/rules/designNotes'
import { addTable } from '../../src/rules/designNotes'
import { lockDesignSession, pauseDesignSession, resumeDesignSession, saveNotes, startDesignSession } from '../../src/data/designSessionActions'
import { seededDb } from '../helpers/db'

const T = new Date('2026-10-11T10:00:00+05:30').getTime()
const MIN = 60_000
type S = { at: number; phase: 'drawing'; pausedAt?: number; pausedMs?: number }

describe('the 45-minute clock with a pause (F2)', () => {
  it('a paused session shows the time it had when it was paused, however long the pause', () => {
    const s = { at: T, pausedAt: T + 10 * MIN }
    expect(clockText(remainingMs(s, T + 10 * MIN))).toBe('35:00')
    expect(clockText(remainingMs(s, T + 5 * 60 * MIN))).toBe('35:00')
  })
  it('earlier pauses are left out of the elapsed time', () => {
    const s = { at: T, pausedMs: 20 * MIN }
    expect(clockText(remainingMs(s, T + 30 * MIN))).toBe('35:00')
    // a second, open pause on top of an earlier one
    const p = { at: T, pausedMs: 20 * MIN, pausedAt: T + 30 * MIN }
    expect(clockText(remainingMs(p, T + 90 * MIN))).toBe('35:00')
  })
  it('a locked session ignores pausedAt: the pause was folded into pausedMs at the lock', () => {
    expect(clockText(remainingMs({ at: T, lockedAt: T + 40 * MIN, pausedMs: 28 * MIN }, T + 99 * MIN))).toBe('33:00')
  })
  it('isOverdue counts drawing time only and never fires while paused', () => {
    expect(isOverdue({ at: T, phase: 'drawing', pausedMs: 30 * MIN }, T + 74 * MIN)).toBe(false)
    expect(isOverdue({ at: T, phase: 'drawing', pausedMs: 30 * MIN }, T + 30 * MIN + SESSION_MS)).toBe(true)
    expect(isOverdue({ at: T, phase: 'drawing', pausedAt: T + 20 * MIN }, T + 500 * MIN)).toBe(false)
    expect(isOverdue({ at: T, phase: 'close', pausedMs: 0 }, T + SESSION_MS)).toBe(false)
  })
  it('lockAt stores the drawing minutes without the pauses', () => {
    expect(lockAt({ at: T, pausedMs: 20 * MIN }, T + 32 * MIN + 300)).toMatchObject({ lockedAt: T + 32 * MIN + 300, minutes: 12 })
    // found past 45 drawing minutes: locks at exactly 45 of them
    expect(lockAt({ at: T, pausedMs: 20 * MIN }, T + 5 * 60 * MIN)).toMatchObject({ lockedAt: T + 20 * MIN + SESSION_MS, minutes: 45 })
  })
  it('lockAt while paused folds the open pause into pausedMs and clears pausedAt', () => {
    const r = lockAt({ at: T, pausedMs: 5 * MIN, pausedAt: T + 20 * MIN }, T + 50 * MIN)
    expect(r).toEqual({ lockedAt: T + 50 * MIN, minutes: 15, pausedMs: 35 * MIN, pausedAt: undefined })
    expect(clockText(remainingMs({ at: T, ...r }, T + 99 * MIN))).toBe('30:00')
  })
  it('lockReason reads timer only when the drawing time reached 45', () => {
    expect(lockReason({ at: T, lockedAt: T + 60 * MIN, pausedMs: 20 * MIN })).toBe('ended')
    expect(lockReason({ at: T, lockedAt: T + 65 * MIN, pausedMs: 20 * MIN })).toBe('timer')
  })
  it('applyPause sets pausedAt once; applyResume adds the pause to pausedMs', () => {
    const s: S = { at: T, phase: 'drawing' }
    const p = applyPause(s, T + 10 * MIN)
    expect(p.pausedAt).toBe(T + 10 * MIN)
    expect(applyPause(p, T + 20 * MIN)).toBe(p)
    const r = applyResume(p, T + 25 * MIN)
    expect(r.pausedMs).toBe(15 * MIN)
    expect('pausedAt' in r).toBe(false)
    expect(applyResume(r, T + 30 * MIN)).toBe(r)
    expect(applyResume({ ...r, pausedMs: 15 * MIN, pausedAt: T + 40 * MIN }, T + 41 * MIN).pausedMs).toBe(16 * MIN)
  })
  it('the clock of a resumed session carries on from where it stopped', () => {
    const r = applyResume(applyPause<S>({ at: T, phase: 'drawing' }, T + 10 * MIN), T + 100 * MIN)
    expect(clockText(remainingMs(r, T + 100 * MIN))).toBe('35:00')
    expect(clockText(remainingMs(r, T + 105 * MIN))).toBe('30:00')
  })
})

describe('the graded line (F2)', () => {
  it('reads per mode', () => {
    expect(gradedText('ai-partner')).toBe('Canvas, notes and the chat are all graded.')
    expect(gradedText('solo')).toBe('Canvas and notes are graded.')
    expect(gradedText('human-partner')).toBe('Your partner scores the canvas and notes.')
    expect(gradedText('interviewer')).toBe('Canvas, notes and the chat are all graded.')
  })
})

describe('accordion counts (F2)', () => {
  it('counts the non-blank lines of a box', () => {
    expect(noteLines('')).toBe(0)
    expect(noteLines('  \n\n')).toBe(0)
    expect(noteLines('a\n\n b \n   \nc')).toBe(3)
  })
  it('sums the boxes of a section and reads 0 when empty', () => {
    let n = emptyNotes()
    expect(sectionCount(n, 'requirements')).toBe('0')
    n = setNoteText(setNoteText(n, 'reqFn', 'a\nb'), 'reqNfr', 'c')
    expect(sectionCount(n, 'requirements')).toBe('3')
    n = setNoteText(n, 'api', 'GET /x')
    expect(sectionCount(n, 'api')).toBe('1')
    expect(sectionCount(setNoteText(n, 'open', 'q1\nq2'), 'open')).toBe('2')
  })
  it('Data model counts tables when there are some, else the lines of its box', () => {
    let n = setNoteText(emptyNotes(), 'dataModel', 'x\ny')
    expect(sectionCount(n, 'data-model')).toBe('2')
    n = addTable(n, 'layers').notes
    expect(sectionCount(n, 'data-model')).toBe('1 table')
    n = addTable(n, 'docs').notes
    expect(sectionCount(n, 'data-model')).toBe('2 tables')
  })
})

describe('pause and resume writes (F2)', () => {
  it('pause stamps the row, resume folds it, and the lock clears an open pause', async () => {
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: ['a', 'b', 'c', 'd'], nowMs: T })
    expect(await pauseDesignSession(d, s.id, T + 10 * MIN)).toBe(true)
    expect((await d.designSessions.get(s.id))!.pausedAt).toBe(T + 10 * MIN)
    expect(await resumeDesignSession(d, s.id, T + 25 * MIN)).toBe(true)
    const r = (await d.designSessions.get(s.id))!
    expect(r.pausedMs).toBe(15 * MIN)
    expect(r.pausedAt).toBeUndefined()
    await pauseDesignSession(d, s.id, T + 30 * MIN)
    expect(await lockDesignSession(d, s.id, T + 60 * MIN)).toBe(true)
    const l = (await d.designSessions.get(s.id))!
    expect(l).toMatchObject({ phase: 'close', lockedAt: T + 60 * MIN, minutes: 15, pausedMs: 45 * MIN })
    expect(l.pausedAt).toBeUndefined()
  })
  it('pause and resume only work while drawing', async () => {
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: ['a', 'b', 'c', 'd'], nowMs: T })
    await lockDesignSession(d, s.id, T + 5 * MIN)
    expect(await pauseDesignSession(d, s.id, T + 6 * MIN)).toBe(false)
    expect(await resumeDesignSession(d, s.id, T + 7 * MIN)).toBe(false)
  })
  it('notes still save on a paused session (the queue that was running when Pause was pressed lands)', async () => {
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: ['a', 'b', 'c', 'd'], nowMs: T })
    await pauseDesignSession(d, s.id, T + MIN)
    expect(await saveNotes(d, s.id, setNoteText(emptyNotes(), 'api', 'late'))).toBe(true)
  })
})

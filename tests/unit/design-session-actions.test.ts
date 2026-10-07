import { describe, expect, it } from 'vitest'
import type { InterviewFinal } from '../../src/ai/types'
import { moveTicket } from '../../src/data/boardActions'
import type { CloseAnswers, DojoEvent } from '../../src/data/types'
import {
  appendInterview, completeDesignSession, discardDesignSession, enterScore, flushThenLock, lockDesignSession, saveCanvas,
  saveClose, saveFinal, saveReference, saveScore, saveView, startDesignSession,
} from '../../src/data/designSessionActions'
import { addNode, emptyCanvas } from '../../src/rules/designCanvas'
import { seededDb } from '../helpers/db'

// smallPlan: design tickets d-method and d-estimate (xp 20 each when done).
const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-11T10:00:00')
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
const CLOSE: CloseAnswers = {
  tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 3, readNext: 'DDIA ch. 5',
}
const LENSES_OK = { load: 2, data: 1, consistency: 1, failure: 0, latency: 2, cost: 1, evolution: 1 } as const
const scored = (rubric: number, answered: (0 | 1 | 2)[] = [2, 1, 2, 0]) => ({
  deepDives: answered.map((a, i) => ({ q: DIVES[i], answered: a })),
  lenses: LENSES_OK,
  tradeoffs: [CLOSE.tradeoff, { chose: 'fail open', over: 'fail closed', because: 'uptime' }],
  rubric,
})

async function toScore(d: Awaited<ReturnType<typeof seededDb>>, at = T, mode: 'solo' | 'interviewer' = 'solo') {
  const s = await startDesignSession(d, { designId: 'd-method', mode, deepDives: DIVES, nowMs: at })
  await lockDesignSession(d, s.id, at + 12 * MIN)
  await enterScore(d, s.id, CLOSE)
  return s.id
}

describe('start, resume, discard (D-3, D-10, D-11)', () => {
  it('creates one open drawing session per design and resumes it', async () => {
    const d = await seededDb()
    const a = await startDesignSession(d, { designId: 'd-method', mode: 'interviewer', deepDives: DIVES, nowMs: T })
    expect(a).toMatchObject({
      designId: 'd-method', at: T, phase: 'drawing', minutes: 0, mode: 'interviewer', view: '2d', rubric: null,
      tradeoffs: [], lenses: {}, interview: { messages: [] },
    })
    expect(a.canvas).toEqual(emptyCanvas())
    expect(a.deepDives).toEqual(DIVES.map(q => ({ q, answered: null })))
    const b = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T + MIN })
    expect(b.id).toBe(a.id)
    expect(await d.designSessions.count()).toBe(1)
  })

  it('discard deletes an open session and nothing else', async () => {
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T })
    expect(await discardDesignSession(d, s.id)).toBe(true)
    expect(await d.designSessions.count()).toBe(0)
  })
})

describe('canvas and lock (D-6, D-8, D-9, D-22)', () => {
  it('saves canvas and view while drawing, refuses canvas after the lock', async () => {
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T })
    const c = addNode(emptyCanvas(), 'gateway').canvas
    expect(await saveCanvas(d, s.id, c)).toBe(true)
    expect(await saveView(d, s.id, 'iso')).toBe(true)
    expect(await lockDesignSession(d, s.id, T + 12 * MIN + 400)).toBe(true)
    const locked = await d.designSessions.get(s.id)
    expect(locked).toMatchObject({ phase: 'close', lockedAt: T + 12 * MIN + 400, minutes: 12, view: 'iso' })
    expect(locked?.canvas).toEqual(c)
    expect(await saveCanvas(d, s.id, emptyCanvas())).toBe(false)
    expect(await lockDesignSession(d, s.id, T + 20 * MIN)).toBe(false)
  })

  it('locks a session found hours later at exactly 45 minutes (Review Focus #1)', async () => {
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T })
    await lockDesignSession(d, s.id, T + 5 * 60 * MIN)
    expect(await d.designSessions.get(s.id)).toMatchObject({ lockedAt: T + 45 * MIN, minutes: 45, phase: 'close' })
  })
})

describe('close, score, interview', () => {
  it('saves close answers, then seeds trade-offs on entering score (D-24, D-27)', async () => {
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T })
    expect(await saveClose(d, s.id, CLOSE)).toBe(false)
    await lockDesignSession(d, s.id, T + MIN)
    expect(await saveClose(d, s.id, CLOSE)).toBe(true)
    expect(await enterScore(d, s.id, CLOSE)).toBe(true)
    const row = await d.designSessions.get(s.id)
    expect(row?.phase).toBe('score')
    expect(row?.tradeoffs).toEqual([CLOSE.tradeoff, { chose: '', over: '', because: '' }])
    expect(await saveScore(d, s.id, { rubric: 12, rubricBy: 'self' })).toBe(true)
    expect((await d.designSessions.get(s.id))?.rubric).toBe(12)
  })

  it('appends transcript messages and stores the final grade with a capped prefill (D-35, D-37)', async () => {
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'interviewer', deepDives: DIVES, nowMs: T })
    await appendInterview(d, s.id, [{ from: 'interviewer', text: '[fake:interview] Turn 0 for d-method' }])
    await appendInterview(d, s.id, [{ from: 'you', text: 'QPS 10k' }])
    expect((await d.designSessions.get(s.id))?.interview?.messages.map(m => m.from)).toEqual(['interviewer', 'you'])
    await lockDesignSession(d, s.id, T + MIN)
    expect(await appendInterview(d, s.id, [{ from: 'you', text: 'late' }])).toBe(false)
    await enterScore(d, s.id, { ...CLOSE, couldNotAnswer: 0 })
    const final = {
      done: true, score: 15, perItem: [], oneThingToStudy: 'x', deepDives: [2, 1, 2, 1],
      lenses: { load: 2, data: 1, consistency: 1, failure: 1, latency: 1, cost: 0, evolution: 1 },
    } as unknown as InterviewFinal
    expect(await saveFinal(d, s.id, final)).toBe(true)
    const row = await d.designSessions.get(s.id)
    expect(row?.interview?.final).toEqual(final)
    expect(row?.deepDives.map(x => x.answered)).toEqual([1, 1, 2, 1])
    expect(row).toMatchObject({ rubric: 15, rubricBy: 'model', lenses: final.lenses })
  })
})

describe('completeDesignSession (D-31, D-45, D-47, Review Focus #3)', () => {
  it('refuses an unready score form', async () => {
    const d = await seededDb()
    const id = await toScore(d)
    expect(await completeDesignSession(d, id, T + 50 * MIN)).toEqual({ ok: false, reason: 'not-ready' })
  })

  it('completes, ticks the design once (+20) and queues a redesign for rubric 12', async () => {
    const d = await seededDb()
    const id = await toScore(d)
    await saveScore(d, id, scored(12))
    const r = await completeDesignSession(d, id, T + 50 * MIN)
    expect(r).toEqual({ ok: true, xpDelta: 20, redesignDue: ist('2026-11-10T00:00:00') })
    expect(await d.designSessions.get(id)).toMatchObject({ phase: 'done', endedAt: T + 50 * MIN, redesignDue: ist('2026-11-10T00:00:00') })
    expect(await d.tickets.get('d-method')).toMatchObject({ status: 'done', xp: 20 })
    expect((await d.events.toArray()).filter(e => e.t === 'tick')).toHaveLength(1)
  })

  it('a second session on a done design earns nothing and queues nothing at rubric 15', async () => {
    const d = await seededDb()
    const first = await toScore(d)
    await saveScore(d, first, scored(12))
    await completeDesignSession(d, first, T + 50 * MIN)
    const second = await toScore(d, ist('2026-11-10T10:00:00'))
    expect((await d.designSessions.get(second))?.redesignOf).toBe(first)
    await saveScore(d, second, scored(15, [1, 1, 2, 1]))
    const r = await completeDesignSession(d, second, ist('2026-11-10T11:00:00'))
    expect(r).toEqual({ ok: true, xpDelta: 0, redesignDue: undefined })
    expect((await d.designSessions.get(second))?.redesignDue).toBeUndefined()
    expect((await d.tickets.get('d-method'))?.xp).toBe(20)
  })

  it('re-ticks a design the learner unticked by hand, keeping net XP at 20', async () => {
    const d = await seededDb()
    const first = await toScore(d)
    await saveScore(d, first, scored(15, [1, 1, 1, 1]))
    await completeDesignSession(d, first, T + 50 * MIN)
    await moveTicket(d, 'd-method', 'todo', T + 60 * MIN)
    const second = await toScore(d, T + 2 * 60 * MIN)
    await saveScore(d, second, scored(16, [2, 1, 1, 1]))
    expect(await completeDesignSession(d, second, T + 3 * 60 * MIN)).toMatchObject({ ok: true, xpDelta: 20 })
    expect(await d.tickets.get('d-method')).toMatchObject({ status: 'done', xp: 20 })
    expect(await d.designSessions.count()).toBe(2)
  })

  it('stores the reference on a done session', async () => {
    const d = await seededDb()
    const id = await toScore(d)
    await saveScore(d, id, scored(12))
    await completeDesignSession(d, id, T + 50 * MIN)
    const ref = { layout: 'layered', nodes: [{ id: 'a', kind: 'service', label: 'A' }], links: [], zones: [], flows: [] }
    expect(await saveReference(d, id, ref as never)).toBe(true)
    expect((await d.designSessions.get(id))?.reference).toEqual(ref)
    expect(await discardDesignSession(d, id)).toBe(false)
  })
})

describe('flushThenLock (D-23 addendum: 45:00 auto-lock and End-drawing confirm)', () => {
  it('runs a still-queued canvas write before locking, so the last edit is not dropped', async () => {
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T })
    const edited = addNode(emptyCanvas(), 'service').canvas
    let flushed = false
    // Stands in for useWriteQueue's flush(): awaits the still-in-flight saveCanvas job.
    const flush = async () => { await saveCanvas(d, s.id, edited); flushed = true }
    expect(await flushThenLock(d, s.id, T + MIN, flush)).toBe(true)
    expect(flushed).toBe(true)
    const row = await d.designSessions.get(s.id)
    expect(row?.canvas).toEqual(edited)
    expect(row?.phase).toBe('close')
  })

  it('documents the bug it fixes: locking before a queued write runs silently drops the edit', async () => {
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T })
    const edited = addNode(emptyCanvas(), 'service').canvas
    await lockDesignSession(d, s.id, T + MIN)
    // saveCanvas is guarded by patchIf(['drawing']); once locked, a late-arriving queued write no-ops.
    expect(await saveCanvas(d, s.id, edited)).toBe(false)
    expect((await d.designSessions.get(s.id))?.canvas).not.toEqual(edited)
  })
})

describe('completed session counts as focus minutes (cu-r3 A15 ruling)', () => {
  type Db = Awaited<ReturnType<typeof seededDb>>
  const focusOf = async (d: Db) => (await d.events.toArray()).filter((e): e is Extract<DojoEvent, { t: 'focus' }> => e.t === 'focus')

  it.each(['solo', 'interviewer'] as const)('%s: one focus event of the timed minutes, shown by every focus reader', async mode => {
    const d = await seededDb()
    const id = await toScore(d, T, mode)
    await saveScore(d, id, scored(16))
    expect((await completeDesignSession(d, id, T + 50 * MIN)).ok).toBe(true)
    const ev = await focusOf(d)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ id: 'd-method', minutes: 12 })
    const all = await d.events.toArray()
    const { focusMinutesOnDay, focusMinutesTotal } = await import('../../src/rules/focus')
    const { localDayKey } = await import('../../src/lib/dates')
    expect(focusMinutesTotal(all)).toBe(12)
    expect(focusMinutesOnDay(all, localDayKey(T + 50 * MIN))).toBe(12)
  })

  it('does not double count focus blocks already finished on that design during the session', async () => {
    const d = await seededDb()
    const id = await toScore(d)
    await d.events.add({ t: 'focus', id: 'd-method', at: T + 5 * MIN, minutes: 5 })
    await saveScore(d, id, scored(16))
    await completeDesignSession(d, id, T + 50 * MIN)
    const ev = await focusOf(d)
    expect(ev.reduce((a, e) => a + e.minutes, 0)).toBe(12)
  })

  it('adds nothing when blocks already cover the session, and a refused completion adds nothing', async () => {
    const d = await seededDb()
    const id = await toScore(d)
    expect((await completeDesignSession(d, id, T + 50 * MIN)).ok).toBe(false)
    expect(await focusOf(d)).toHaveLength(0)
    await d.events.add({ t: 'focus', id: 'd-method', at: T + 5 * MIN, minutes: 20 })
    await saveScore(d, id, scored(16))
    await completeDesignSession(d, id, T + 50 * MIN)
    expect(await focusOf(d)).toHaveLength(1)
  })
})

import { describe, expect, it } from 'vitest'
import {
  completeDesignSession, enterScore, lockDesignSession, saveScore, startDesignSession,
} from '../../src/data/designSessionActions'
import { createDb, type DojoDB } from '../../src/data/db'
import { runReconcile } from '../../src/data/seed'
import type { SyncGate } from '../../src/data/sync/middleware'
import type { CloseAnswers, DesignSession, Redo } from '../../src/data/types'
import { designRedoEffect } from '../../src/rules/redoQueue'
import { reviewCards } from '../../src/rules/reviewQueue'
import { flatPlanV2 } from '../helpers/plan'
import { seededDb } from '../helpers/db'

// review.md Preconditions (design replay redo) and REVIEW-15a. Design tickets in flatPlanV2: d-method, d-estimate.
const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-11T10:00:00')
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
const CLOSE: CloseAnswers = {
  tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 3, readNext: 'DDIA ch. 5',
}
const LENSES_OK = { load: 2, data: 1, consistency: 1, failure: 0, latency: 2, cost: 1, evolution: 1 } as const
const answers = (a: (0 | 1 | 2)[]) => a.map((x, i) => ({ q: DIVES[i], answered: x }))
const scored = (rubric: number, answered: (0 | 1 | 2)[] = [1, 1, 2, 1]) => ({
  deepDives: answers(answered), lenses: LENSES_OK,
  tradeoffs: [CLOSE.tradeoff, { chose: 'fail open', over: 'fail closed', because: 'uptime' }], rubric,
})

async function toScore(d: DojoDB, at: number, designId = 'd-method') {
  const s = await startDesignSession(d, { designId, mode: 'solo', deepDives: DIVES, nowMs: at })
  await lockDesignSession(d, s.id, at + 12 * MIN)
  await enterScore(d, s.id, CLOSE)
  return s.id
}
/** Start, score and complete one session; returns its id. */
async function finish(d: DojoDB, at: number, rubric: number, answered?: (0 | 1 | 2)[], designId = 'd-method') {
  const id = await toScore(d, at, designId)
  await saveScore(d, id, scored(rubric, answered))
  const r = await completeDesignSession(d, id, at + 50 * MIN)
  expect(r.ok).toBe(true)
  return id
}
const redosOf = (d: DojoDB, ticketId = 'd-method') => d.redos.where('ticketId').equals(ticketId).toArray()

describe('design_rubric redo producer (completeDesignSession)', () => {
  it('a rubric of 12 writes exactly one open redo: design_rubric, stage 0, due = redesignDue', async () => {
    const d = await seededDb()
    const id = await finish(d, T, 12)
    const due = (await d.designSessions.get(id))?.redesignDue
    expect(due).toBe(ist('2026-11-10T00:00:00'))
    const redos = await redosOf(d)
    expect(redos).toHaveLength(1)
    expect(redos[0]).toMatchObject({
      ticketId: 'd-method', source: 'design_rubric', stage: 0, due, passed: [], helpCost: 0, refunded: 0, createdAt: T + 50 * MIN,
    })
    expect(redos[0].closedAt).toBeUndefined()
  })

  it('a zero deep dive with a high rubric also queues the redo', async () => {
    const d = await seededDb()
    await finish(d, T, 18, [2, 1, 2, 0])
    expect(await redosOf(d)).toHaveLength(1)
  })

  it('reviewCards at redesignDue shows it as a design replay card to /designs/session/<id>', async () => {
    const d = await seededDb()
    const id = await finish(d, T, 12)
    const due = (await d.designSessions.get(id))?.redesignDue as number
    const args = { redos: await d.redos.toArray(), tickets: await d.tickets.toArray() }
    expect(reviewCards({ ...args, nowMs: due - 1 })).toEqual([])
    const cards = reviewCards({ ...args, nowMs: due + 10 * MIN })
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ kind: 'replay', ticketKind: 'design', ticketId: 'd-method', to: '/designs/session/d-method', redoLabel: 'REDO · DESIGN' })
  })

  it('a second completion on a ticket with an open redo writes no second one', async () => {
    const d = await seededDb()
    await finish(d, T, 12)
    // a session that is not linked as a redesign (rule 3: at most one open redo per ticket)
    const id = await toScore(d, ist('2026-10-12T10:00:00'))
    const row = (await d.designSessions.get(id)) as DesignSession
    const { redesignOf: _drop, ...unlinked } = row
    await d.designSessions.put(unlinked as DesignSession)
    await saveScore(d, id, scored(12))
    await completeDesignSession(d, id, ist('2026-10-12T11:00:00'))
    const redos = await redosOf(d)
    expect(redos).toHaveLength(1)
    expect(redos[0].closedAt).toBeUndefined()
  })

  it('a passing redesign (rubric 18) closes the redo', async () => {
    const d = await seededDb()
    const first = await finish(d, T, 12)
    const at = ist('2026-11-10T10:00:00')
    const second = await toScore(d, at)
    expect((await d.designSessions.get(second))?.redesignOf).toBe(first)
    await saveScore(d, second, scored(18, [2, 1, 2, 2]))
    await completeDesignSession(d, second, at + 50 * MIN)
    const redos = await redosOf(d)
    expect(redos).toHaveLength(1)
    expect(redos[0]).toMatchObject({ source: 'design_rubric', closedAt: at + 50 * MIN, passed: [true] })
    // closed: nothing is due any more
    expect(reviewCards({ redos, tickets: await d.tickets.toArray(), nowMs: at + 60 * MIN })).toEqual([])
  })

  it('a failing redesign (rubric 12) keeps one open redo, due = the new redesignDue, passed gains false', async () => {
    const d = await seededDb()
    await finish(d, T, 12)
    const at = ist('2026-11-10T10:00:00')
    const second = await finish(d, at, 12)
    const newDue = (await d.designSessions.get(second))?.redesignDue
    expect(newDue).toBe(ist('2026-12-10T00:00:00'))
    const redos = await redosOf(d)
    expect(redos).toHaveLength(1)
    expect(redos[0]).toMatchObject({ source: 'design_rubric', stage: 0, due: newDue, passed: [false] })
    expect(redos[0].closedAt).toBeUndefined()
    // fail again then pass: passed keeps the history
    const third = await toScore(d, ist('2026-12-10T10:00:00'))
    await saveScore(d, third, scored(18, [2, 1, 2, 2]))
    await completeDesignSession(d, third, ist('2026-12-10T11:00:00'))
    expect((await redosOf(d))[0]).toMatchObject({ passed: [false, true], closedAt: ist('2026-12-10T11:00:00') })
  })

  it('a rubric of 18 with no open redo writes no redo', async () => {
    const d = await seededDb()
    await finish(d, T, 18, [2, 1, 2, 2])
    expect(await d.redos.count()).toBe(0)
  })

  it('one ticket does not touch another ticket\'s redo', async () => {
    const d = await seededDb()
    await finish(d, T, 12)
    await finish(d, T, 18, [2, 1, 2, 2], 'd-estimate')
    expect(await redosOf(d, 'd-estimate')).toHaveLength(0)
    expect(await redosOf(d, 'd-method')).toHaveLength(1)
  })

  it('a session finished before R1 writes nothing: reopening, reconciling and a passing redesign add no redo', async () => {
    const d = await seededDb()
    const old = await finish(d, T, 18, [2, 1, 2, 2])
    await d.redos.clear()
    // pre-R1 shape: done, redesign outstanding, no redo
    await d.designSessions.update(old, { redesignDue: ist('2026-11-10T00:00:00') })
    await runReconcile(d, flatPlanV2)
    d.close()
    await d.open()
    expect(await d.redos.count()).toBe(0)
    // its redesign passes: there is no redo to close and none is created
    const at = ist('2026-11-10T10:00:00')
    const second = await toScore(d, at)
    expect((await d.designSessions.get(second))?.redesignOf).toBe(old)
    await saveScore(d, second, scored(18, [2, 1, 2, 2]))
    await completeDesignSession(d, second, at + 50 * MIN)
    expect(await d.redos.count()).toBe(0)
  })

  it('read-only or model-locked: completion is refused and no redo is written', async () => {
    const gate: SyncGate = { bypass: false }
    const d = createDb(`redo-producer-${Math.random().toString(36).slice(2)}`, gate)
    await runReconcile(d, flatPlanV2)
    const id = await toScore(d, T)
    await saveScore(d, id, scored(12))
    gate.readOnly = true
    await expect(completeDesignSession(d, id, T + 50 * MIN)).rejects.toThrow()
    expect(await d.redos.count()).toBe(0)
    expect((await d.designSessions.get(id))?.phase).toBe('score')
    expect((await d.tickets.get('d-method'))?.status).not.toBe('done')
  })
})

describe('designRedoEffect (pure rule)', () => {
  const now = ist('2026-11-10T11:00:00')
  const due = ist('2026-12-10T00:00:00')
  const open: Redo = { id: 'r1', ticketId: 'd-method', source: 'design_rubric', createdAt: T, stage: 0, due: ist('2026-11-10T00:00:00'), passed: [], helpCost: 0, refunded: 0 }
  const base = { nowMs: now, newRedoId: 'r-new' }

  it('creates when a redesign is due and nothing is open', () => {
    const e = designRedoEffect({ ...base, open: null, session: { designId: 'd-method' }, redesignDue: due })
    expect(e).toEqual({ kind: 'created', redo: { id: 'r-new', ticketId: 'd-method', source: 'design_rubric', createdAt: now, stage: 0, due, passed: [], helpCost: 0, refunded: 0 } })
  })
  it('does nothing when no redesign is due and nothing is open', () => {
    expect(designRedoEffect({ ...base, open: null, session: { designId: 'd-method' }, redesignDue: undefined })).toEqual({ kind: 'none' })
  })
  it('never creates a second open redo (any source, redesign or not)', () => {
    expect(designRedoEffect({ ...base, open, session: { designId: 'd-method' }, redesignDue: due })).toEqual({ kind: 'none' })
    const other = { ...open, source: 'gave_up' as const }
    expect(designRedoEffect({ ...base, open: other, session: { designId: 'd-method', redesignOf: 'ds-1' }, redesignDue: due })).toEqual({ kind: 'none' })
  })
  it('a redesign closes the open redo when no new redesign is due', () => {
    const e = designRedoEffect({ ...base, open, session: { designId: 'd-method', redesignOf: 'ds-1' }, redesignDue: undefined })
    expect(e).toEqual({ kind: 'closed', redo: { ...open, passed: [true], closedAt: now } })
  })
  it('a redesign reschedules the open redo when a new redesign is due', () => {
    const e = designRedoEffect({ ...base, open, session: { designId: 'd-method', redesignOf: 'ds-1' }, redesignDue: due })
    expect(e).toEqual({ kind: 'rescheduled', redo: { ...open, passed: [false], due } })
  })
  it('a redesign with no open redo behaves as a plain completion', () => {
    expect(designRedoEffect({ ...base, open: null, session: { designId: 'd-method', redesignOf: 'ds-1' }, redesignDue: undefined })).toEqual({ kind: 'none' })
    expect(designRedoEffect({ ...base, open: null, session: { designId: 'd-method', redesignOf: 'ds-1' }, redesignDue: due }).kind).toBe('created')
  })
})

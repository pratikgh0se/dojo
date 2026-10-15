import { describe, expect, it } from 'vitest'
import { completeDesignSession, enterScore, keepMissedSpots, lockDesignSession, saveScore, startDesignSession } from '../../src/data/designSessionActions'
import type { DesignSession } from '../../src/data/types'
import { applyGrade } from '../../src/data/redoGrade'
import { seededDb } from '../helpers/db'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-11-04T21:00:00')
const MISSED = [
  { topic: 'partition key', question: 'What makes a good partition key?', answer: 'Even spread.' },
  { topic: 'tile fetch API', question: 'How does a client fetch a tile?', answer: 'A read call.' },
  { topic: 'conflict rule', question: 'What does last-writer-wins cost?', answer: 'The earlier edit.' },
]
const row = (over: Partial<DesignSession> = {}): DesignSession => ({
  id: 'ds-a', designId: 'd-method', at: T - 3_600_000, phase: 'done', endedAt: T - 60_000, minutes: 45, mode: 'ai-partner', view: '2d',
  canvas: { layout: 'manual', nodes: [], links: [], zones: [], flows: [] } as never, close: {} as never, deepDives: [], tradeoffs: [], rubric: 15, lenses: {},
  interview: { messages: [], final: { done: true, score: 15, perItem: [], oneThingToStudy: '', deepDives: [2, 1, 1, 1], lenses: {} as never, missed: MISSED } },
  ...over,
})

describe('keepMissedSpots (DESIGN-103 to 107)', () => {
  it('writes one design_missed redo per entry plus keptAt, nothing else', async () => {
    const d = await seededDb()
    await d.designSessions.add(row())
    const before = { tickets: await d.tickets.toArray(), events: await d.events.count() }
    const r = await keepMissedSpots(d, 'ds-a', T)
    expect(r).toEqual({ ok: true, count: 3 })
    const redos = (await d.redos.toArray()).sort((a, b) => a.id.localeCompare(b.id))
    expect(redos.map(x => x.id)).toEqual(['keep-ds-a-1', 'keep-ds-a-2', 'keep-ds-a-3'])
    expect(redos[1]).toMatchObject({ ticketId: 'd-method', source: 'design_missed', stage: 0, due: '2026-11-05', piece: { ...MISSED[1], sessionId: 'ds-a' } })
    expect(redos[1].closedAt).toBeUndefined()
    expect((await d.designSessions.get('ds-a'))?.keptAt).toBe(T)
    expect(await d.tickets.toArray()).toEqual(before.tickets)
    expect(await d.events.count()).toBe(before.events)
  })
  it('a second add writes nothing and does not reset a graded card', async () => {
    const d = await seededDb()
    await d.designSessions.add(row())
    await keepMissedSpots(d, 'ds-a', T)
    const due = ist('2026-11-05T10:00:00')
    expect(await applyGrade(d, 'keep-ds-a-1', 'got', due)).toBe(true)
    const graded = await d.redos.get('keep-ds-a-1')
    expect(graded?.stage).toBe(1)
    expect(await keepMissedSpots(d, 'ds-a', due)).toEqual({ ok: false, reason: 'kept' })
    expect(await d.redos.get('keep-ds-a-1')).toEqual(graded)
    expect(await d.redos.count()).toBe(3)
    expect((await d.designSessions.get('ds-a'))?.keptAt).toBe(T)
  })
  it.each([
    ['a missing session', 'nope', row()],
    ['a session without weak spots', 'ds-a', row({ interview: { messages: [] } })],
    ['a With someone session', 'ds-a', row({ mode: 'human-partner' })],
    ['a session still in progress', 'ds-a', row({ phase: 'score' })],
  ])('refuses %s and writes nothing', async (_n, id, s) => {
    const d = await seededDb()
    await d.designSessions.add(s)
    expect((await keepMissedSpots(d, id, T)).ok).toBe(false)
    expect(await d.redos.count()).toBe(0)
    expect((await d.designSessions.get('ds-a'))?.keptAt).toBeUndefined()
  })
})

describe('kept cards and the design_rubric redo (DESIGN-107)', () => {
  const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
  const CLOSE = { tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 3, readNext: 'DDIA ch. 5' }
  it('open design_missed redos on the ticket do not stop a failing session from writing its design_rubric redo', async () => {
    const d = await seededDb()
    await d.designSessions.add(row())
    await keepMissedSpots(d, 'ds-a', T)
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T + 86_400_000 })
    await lockDesignSession(d, s.id, T + 86_400_000 + 12 * 60_000)
    await enterScore(d, s.id, CLOSE as never)
    await saveScore(d, s.id, {
      deepDives: DIVES.map(q => ({ q, answered: 1 as const })), lenses: { load: 2, data: 1, consistency: 1, failure: 0, latency: 2, cost: 1, evolution: 1 },
      tradeoffs: [CLOSE.tradeoff, { chose: 'x', over: 'y', because: 'z' }], rubric: 9,
    })
    expect((await completeDesignSession(d, s.id, T + 86_400_000 + 50 * 60_000)).ok).toBe(true)
    const redos = await d.redos.where('ticketId').equals('d-method').toArray()
    expect(redos.filter(r => r.source === 'design_rubric' && r.closedAt === undefined)).toHaveLength(1)
    expect(redos.filter(r => r.source === 'design_missed' && r.closedAt === undefined)).toHaveLength(3)
  })
})

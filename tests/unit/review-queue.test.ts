import { describe, expect, it } from 'vitest'
import type { Redo } from '../../src/data/types'
import { dueLabel, gradeRedo, queueMeta, reviewCards, storedAnswerOf } from '../../src/rules/reviewQueue'
import { isRedoDue } from '../../src/rules/redoQueue'
import { mkTicket } from '../helpers/planV2'

const DAY = 86_400_000
const now = new Date(2026, 10, 4, 10).getTime()
const redo = (id: string, ticketId: string, daysAgo: number, over: Partial<Redo> = {}): Redo =>
  ({ id, ticketId, source: 'check_failed', createdAt: now - 9 * DAY, stage: 0, due: now - daysAgo * DAY, passed: [], helpCost: 0, refunded: 0, ...over })

describe('reviewCards', () => {
  const tickets = [
    mkTicket({ id: 'p1', kind: 'problem', title: '200 · Number of Islands', lane: 'dsa' }),
    mkTicket({ id: 'w1', kind: 'watch', title: 'Watch attention', lane: 'path', explain: ['Why is decode memory-bound?'], explainAnswers: ['The GPU re-reads every weight per token.'] }),
    mkTicket({ id: 'd1', kind: 'design', title: 'Design a URL shortener', lane: 'design' }),
    mkTicket({ id: 'gone', kind: 'problem', archived: true, lane: 'dsa' }),
  ]
  const redos = [redo('r1', 'p1', 2), redo('r2', 'w1', 0), redo('r3', 'p1', -3), redo('r4', 'gone', 5), redo('r5', 'w1', 1, { closedAt: now }), redo('r6', 'd1', 1)]
  const cards = reviewCards({ redos, tickets, nowMs: now })
  it('lists only live redos that are due, oldest first, and skips archived tickets', () => {
    expect(cards.map(c => c.redoId)).toEqual(['r1', 'r6', 'r2'])
  })
  it('makes a check card for a learning ticket and keeps its stored answer out of the prompt', () => {
    const c = cards.find(x => x.ticketId === 'w1')!
    expect(c).toMatchObject({ kind: 'check', ticketKind: 'watch', lane: 'path', prompt: 'Why is decode memory-bound?', stored: 'The GPU re-reads every weight per token.', ageDays: 0 })
    expect(c.prompt).not.toContain('GPU')
  })
  it('makes a replay card with the accent label and the route, and shows the title verbatim', () => {
    expect(cards[0]).toMatchObject({ kind: 'replay', ticketKind: 'problem', title: '200 · Number of Islands', lane: 'dsa', to: '/do/p1', redoLabel: 'REDO · PROBLEM', stored: '' })
    expect(cards[1]).toMatchObject({ kind: 'replay', ticketKind: 'design', lane: 'design', to: '/designs/session/d1', redoLabel: 'REDO · DESIGN' })
  })
  it('labels a write-up replay REDO · WRITE-UP and sends it to the design session route', () => {
    const w = mkTicket({ id: 'wu', kind: 'writeup', lane: 'design' })
    expect(reviewCards({ redos: [redo('rw', 'wu', 1)], tickets: [w], nowMs: now })[0]).toMatchObject({ kind: 'replay', redoLabel: 'REDO · WRITE-UP', to: '/designs/session/wu' })
  })
  it('falls back to a legacy brief for the stored answer and to the title for the question', () => {
    const legacy = mkTicket({ id: 'l', kind: 'read', title: 'Read: Raft', brief: { questions: [{ id: 'q', kind: 'open', q: 'x', keyIdeas: ['leader', 'term'] }] } as never })
    expect(storedAnswerOf(legacy)).toBe('leader; term')
    const c = reviewCards({ redos: [redo('r9', 'l', 1)], tickets: [legacy], nowMs: now })[0]
    expect(c.prompt).toBe('Explain "Read: Raft" in your own words.')
  })
  it('tags a bank ticket as DSA and a career ticket as Career (README lane tag)', () => {
    const bank = mkTicket({ id: 'bk', kind: 'problem', lane: 'bank', origin: 'bank' as never })
    const career = mkTicket({ id: 'cr', kind: 'read', lane: 'career' })
    const cs = reviewCards({ redos: [redo('rb', 'bk', 1), redo('rc', 'cr', 1)], tickets: [bank, career], nowMs: now })
    expect(cs.map(c => c.lane).sort()).toEqual(['career', 'dsa'])
    expect(queueMeta(cs).split).toBe('DSA 1 · Career 1')
  })
  it('counts the age in whole local days from the due day, whatever the clock time', () => {
    const t = mkTicket({ id: 'a', kind: 'watch' })
    const late = redo('late', 'a', 0, { due: new Date(2026, 10, 3, 23, 30).getTime() })
    expect(reviewCards({ redos: [late], tickets: [t], nowMs: now })[0].ageDays).toBe(1)
  })
  it('orders two redos due the same local day by createdAt, then ticket id (README "Oldest due")', () => {
    const a = mkTicket({ id: 'a', kind: 'watch' })
    const b = mkTicket({ id: 'b', kind: 'watch' })
    const c = mkTicket({ id: 'c', kind: 'watch' })
    const d1 = new Date(2026, 10, 3, 22).getTime()
    const d2 = new Date(2026, 10, 3, 8).getTime()
    const got = reviewCards({
      redos: [
        redo('x1', 'a', 0, { due: d1, createdAt: now - 2 * DAY }),
        redo('x2', 'b', 0, { due: d2, createdAt: now - 5 * DAY }),
        redo('x3', 'c', 0, { due: d2, createdAt: now - 2 * DAY }),
      ],
      tickets: [a, b, c], nowMs: now,
    }).map(x => x.redoId)
    expect(got).toEqual(['x2', 'x1', 'x3'])
  })
  it('words the age without blame and summarises the queue', () => {
    expect(dueLabel(0)).toBe('due today')
    expect(dueLabel(1)).toBe('due 1 day ago')
    expect(queueMeta(cards)).toEqual({ count: 3, oldest: 'Oldest 2 days', split: 'AI 1 · DSA 1 · Design 1' })
    expect(queueMeta([]).oldest).toBe('Oldest due today')
    expect(queueMeta(cards.filter(c => c.ageDays === 1)).oldest).toBe('Oldest 1 day')
  })
})

describe('gradeRedo', () => {
  const r = redo('r', 't', 1, { stage: 0 })
  it('Got it moves up a step and out of today', () => {
    const g = gradeRedo(r, 'got', now)
    expect(g).toMatchObject({ stage: 1, passed: [true] })
    expect(isRedoDue(g, now)).toBe(false)
  })
  it('Got it on the last step closes the redo', () => {
    expect(gradeRedo({ ...r, stage: 2 }, 'got', now)).toMatchObject({ closedAt: now, passed: [true] })
  })
  it('Close keeps the step and comes back tomorrow', () => {
    const g = gradeRedo(r, 'close', now)
    expect(g.stage).toBe(0)
    expect(isRedoDue(g, now)).toBe(false)
    expect(isRedoDue(g, now + DAY)).toBe(true)
  })
  it('Missed it writes nothing', () => {
    expect(gradeRedo(r, 'missed', now)).toBe(r)
  })
})

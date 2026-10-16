import { describe, expect, it } from 'vitest'
import type { Redo } from '../../src/data/types'
import { dueRedos, EXPLAIN_DAILY_CAP, redoRows } from '../../src/rules/redoQueue'
import { gradeRedo, queueMeta, reviewCards } from '../../src/rules/reviewQueue'
import { mkTicket } from '../helpers/planV2'

const DAY = 86_400_000
const now = new Date(2026, 10, 4, 10).getTime()
const tk = mkTicket({ id: 'w1', kind: 'watch', title: 'Watch attention', lane: 'path', explain: ['Q?'], explainAnswers: ['A.'] })
const wr = mkTicket({ id: 'wr', kind: 'writeup', title: 'Write it up', lane: 'path', explain: ['WQ?'], explainAnswers: ['WA.'] })
const ex = (i: number, daysAgo: number, t = 'w1'): Redo => ({
  id: `ex-${t}-${i}`, ticketId: t, source: 'explain', createdAt: now - 9 * DAY, stage: 0, due: now - daysAgo * DAY,
  passed: [], helpCost: 0, refunded: 0, piece: { topic: 'T', question: `Q${i}?`, answer: `A${i}.` },
})
const other = (id: string, daysAgo: number): Redo => ({ id, ticketId: 'w1', source: 'check_failed', createdAt: now - 9 * DAY, stage: 0, due: now - daysAgo * DAY, passed: [], helpCost: 0, refunded: 0 })

describe('the explain cap', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => ex(i, 12 - i)) // ex-w1-0 is the oldest due
  it('shows the 10 oldest-due explain cards and holds the rest back', () => {
    const ids = dueRedos(twelve, [tk], now).map(e => e.redo.id)
    expect(ids).toHaveLength(EXPLAIN_DAILY_CAP)
    expect(ids).toEqual(Array.from({ length: 10 }, (_, i) => `ex-w1-${i}`))
  })
  it('the cap applies only to explain: other sources are never held back', () => {
    const others = Array.from({ length: 15 }, (_, i) => other(`o${i}`, 1))
    const entries = dueRedos([...twelve, ...others], [tk], now)
    expect(entries.filter(e => e.redo.source === 'explain')).toHaveLength(10)
    expect(entries.filter(e => e.redo.source === 'check_failed')).toHaveLength(15)
  })
  it('a graded card leaves the queue and the next oldest comes in', () => {
    const graded = twelve.map((r, i) => (i === 0 ? gradeRedo(r, 'got', now) : r))
    const ids = dueRedos(graded, [tk], now).map(e => e.redo.id)
    expect(ids).toHaveLength(10)
    expect(ids).toContain('ex-w1-10')
    expect(ids).not.toContain('ex-w1-0')
    // the queue stays full while 10 are due; the count falls only after the waiting ones are in (RIT-12)
    const n = (k: number) => dueRedos(twelve.map((r, i) => (i < k ? gradeRedo(r, 'got', now) : r)), [tk], now).length
    expect([n(0), n(1), n(2), n(3)]).toEqual([10, 10, 10, 9])
  })
  it('the Review queue and Today\'s redo rows agree on the capped set, and queueMeta counts it', () => {
    const cards = reviewCards({ redos: twelve, tickets: [tk], nowMs: now })
    expect(cards).toHaveLength(10)
    expect(redoRows(twelve, [tk], [], now)).toHaveLength(10)
    expect(queueMeta(cards).count).toBe(10)
  })
  it('ties on due day, createdAt and ticket end on the redo id ascending', () => {
    const four = [3, 1, 2, 0].map(i => ({ ...ex(i, 5), createdAt: now - 9 * DAY }))
    const more = Array.from({ length: 8 }, (_, i) => ({ ...ex(10 + i, 5), createdAt: now - 9 * DAY }))
    const ids = dueRedos([...four, ...more], [tk], now).map(e => e.redo.id)
    expect(ids.slice(0, 4)).toEqual(['ex-w1-0', 'ex-w1-1', 'ex-w1-10', 'ex-w1-11'])
    expect(ids).toHaveLength(10)
    expect(ids).not.toContain('ex-w1-3') // string order: the greatest id waits
  })
  it('exactly 10 and exactly 11 explain cards', () => {
    expect(dueRedos(twelve.slice(0, 10), [tk], now)).toHaveLength(10)
    expect(dueRedos(twelve.slice(0, 11), [tk], now)).toHaveLength(10)
  })
  it('a not-yet-due explain card does not use a slot', () => {
    const future = { ...ex(99, 0), due: '2026-11-05' }
    expect(dueRedos([future, ...twelve.slice(0, 10)], [tk], now)).toHaveLength(10)
  })
})

describe('explain cards in Review', () => {
  it('is a check card with the stored question and answer, on any ticket kind, titled by the ticket, linking to the ticket', () => {
    const cards = reviewCards({ redos: [ex(0, 1), ex(0, 1, 'wr')], tickets: [tk, wr], nowMs: now })
    expect(cards[0]).toMatchObject({ kind: 'check', ticketKind: 'watch', title: 'Watch attention', prompt: 'Q0?', stored: 'A0.', to: '/do/w1', ageDays: 1 })
    expect(cards[1]).toMatchObject({ kind: 'check', ticketKind: 'writeup', prompt: 'Q0?', stored: 'A0.' })
  })
  it('is not due before its day and reads as due today on its day', () => {
    expect(reviewCards({ redos: [{ ...ex(0, 0), due: '2026-11-05' }], tickets: [tk], nowMs: now })).toEqual([])
    expect(reviewCards({ redos: [{ ...ex(0, 0), due: '2026-11-04' }], tickets: [tk], nowMs: now })[0].ageDays).toBe(0)
  })
  it('Today\'s redo row reads as the question and opens Review', () => {
    expect(redoRows([ex(0, 1)], [tk], [], now)[0]).toMatchObject({ text: 'Watch attention · Q0?', to: '/review' })
  })
})

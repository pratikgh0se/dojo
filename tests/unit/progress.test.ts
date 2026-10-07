import { describe, expect, it } from 'vitest'
import type { Session, StoredEvent, Ticket } from '../../src/data/types'
import { burnMarkers, burnUp, focusText, outcomesBySprint, pace, rings } from '../../src/rules/progress'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const START = '2026-10-05' // S1 Oct 5–18, S2 Oct 19–Nov 1, S3 Nov 2–15

const base = (): Ticket[] => [
  mkTicket({ id: 'a1', track: 'ai', kind: 'stage', plannedSprint: 1, sprint: 1, order: 0 }),
  mkTicket({ id: 'a2', track: 'ai', kind: 'stage', plannedSprint: 1, sprint: 1, order: 1 }),
  mkTicket({ id: 'a3', track: 'ai', kind: 'stage', plannedSprint: 3, sprint: 3, order: 2 }),
  mkTicket({ id: 'i1', track: 'interview', kind: 'task', plannedSprint: 1, sprint: 1, order: 3 }),
  mkTicket({ id: 'p1', track: 'interview', kind: 'problem', difficulty: 'H', plannedSprint: 1, sprint: 1, order: 4 }),
  mkTicket({ id: 'd1', track: 'interview', kind: 'design', plannedSprint: 2, sprint: 2, order: 5 }),
  mkTicket({ id: 'x', archived: true, status: 'done', doneAt: ist('2026-10-06T10:00:00'), plannedSprint: 1 }),
]
const done = (ts: Ticket[], ids: string[], at: string) =>
  ts.map(t => (ids.includes(t.id) ? { ...t, status: 'done' as const, doneAt: ist(at) } : t))
const session = (id: string, start: string, minutes: number, outcome: Session['outcome']): Session => ({
  id, ticketId: 'p1', start: ist(start), end: ist(start) + minutes * 60_000, minutes, outcome, xpDelta: 0,
})

describe('rings', () => {
  it('counts live tickets per bucket', () => {
    expect(rings(done(base(), ['a1', 'p1'], '2026-10-06T10:00:00'))).toEqual({
      all: { done: 2, total: 6 }, ai: { done: 1, total: 3 }, interview: { done: 1, total: 3 },
      dsa: { done: 1, total: 1 }, designs: { done: 0, total: 1 },
    })
  })
})

describe('burnUp', () => {
  const ts = done(done(base(), ['a1'], '2026-10-06T10:00:00'), ['p1'], '2026-10-20T10:00:00')
  it('is cumulative plan vs done by doneAt sprint, done null after now', () => {
    expect(burnUp(ts, START, 2, 4)).toEqual([
      { sprint: 1, plan: 4, done: 1 },
      { sprint: 2, plan: 5, done: 2 },
      { sprint: 3, plan: 6, done: null },
      { sprint: 4, plan: 6, done: null },
    ])
  })
  it('is monotonic', () => {
    const pts = burnUp(ts, START, 4, 4)
    pts.slice(1).forEach((p, i) => {
      expect(p.plan).toBeGreaterThanOrEqual(pts[i].plan)
      expect(p.done!).toBeGreaterThanOrEqual(pts[i].done!)
    })
  })
  it('before start is the plan line only (Review Focus #5)', () => {
    expect(burnUp(ts, START, 0, 3).every(p => p.done === null)).toBe(true)
  })
  it('counts a ticket done before the start date at S1', () => {
    expect(burnUp(done(base(), ['i1'], '2026-10-01T10:00:00'), START, 1, 1)[0].done).toBe(1)
  })
})

describe('burnMarkers', () => {
  it('marks slide_sprint and shift_plan events at their sprint', () => {
    const events: StoredEvent[] = [
      { t: 'slide_sprint', at: ist('2026-10-20T10:00:00'), sprint: 1, count: 2, to: 2, ids: ['a', 'b'] },
      { t: 'shift_plan', at: ist('2026-11-03T10:00:00'), fromSprint: 3, ids: [], to: {} },
      { t: 'tick', id: 'a', at: ist('2026-10-06T10:00:00'), xp: 10 },
    ]
    expect(burnMarkers(events, START, 5, 72)).toEqual([
      { sprint: 5, kind: 'now' },
      { sprint: 2, kind: 'slide' },
      { sprint: 3, kind: 'shift' },
    ])
  })
  it('drops the NOW marker before the start date or after the plan window', () => {
    expect(burnMarkers([], START, 0, 72)).toEqual([])
    expect(burnMarkers([], START, 73, 72)).toEqual([])
  })
  it('drops markers for undone events, keeps non-undone ones', () => {
    const events: StoredEvent[] = [
      { t: 'slide_sprint', at: ist('2026-10-20T10:00:00'), sprint: 1, count: 2, to: 2, ids: ['a', 'b'], seq: 1 },
      { t: 'shift_plan', at: ist('2026-11-03T10:00:00'), fromSprint: 3, ids: [], to: {}, seq: 2 },
      { t: 'undo', at: ist('2026-11-04T10:00:00'), of: 1 },
      { t: 'undo', at: ist('2026-11-04T10:05:00'), of: 2 },
      { t: 'slide_sprint', at: ist('2026-11-05T10:00:00'), sprint: 4, count: 1, to: 5, ids: ['c'], seq: 3 },
    ]
    expect(burnMarkers(events, START, -1, 72)).toEqual([
      { sprint: 3, kind: 'slide' },
    ])
  })
})

describe('pace', () => {
  const S2 = ist('2026-10-20T10:00:00')
  it('compares done with the tickets planned before the current sprint', () => {
    const p = pace(done(base(), ['a1', 'p1'], '2026-10-06T10:00:00'), [], START, S2)
    expect(p.rows).toEqual([
      { track: 'ai', expected: 2, done: 1, verdict: 'behind' },
      { track: 'interview', expected: 2, done: 1, verdict: 'behind' },
      { track: 'dsa', expected: 1, done: 1, verdict: 'on' },
      { track: 'designs', expected: 0, done: 0, verdict: 'on' },
    ])
    const early = pace(done(base(), ['d1'], '2026-10-06T10:00:00'), [], START, S2)
    expect(early.rows.find(r => r.track === 'designs')!.verdict).toBe('ahead')
  })
  it('reports focus hours from the logged focus minutes (ruling 24 S3), hard solved, projected finish', () => {
    const focus = (at: string, minutes: number): StoredEvent => ({ t: 'focus', id: 'p1', at: ist(at), minutes })
    const p = pace(done(base(), ['a1', 'p1'], '2026-10-06T10:00:00'), [focus('2026-10-06T21:10:00', 90), focus('2026-10-07T21:10:00', 30)], START, S2)
    expect(p.hours).toBe(2)
    expect(p.hardSolved).toBe(1)
    expect(p.finishSprint).toBe(6) // 2 done in 2 sprints → 1/sprint; 4 left → S2 + 4
  })
  it('UAT cu-2p P3-3: under an hour the Focus well reads minutes, so 2 minutes is not "0 h"', () => {
    const focus = (minutes: number): StoredEvent => ({ t: 'focus', id: 'p1', at: ist('2026-10-06T21:10:00'), minutes })
    const text = (m: number) => focusText(pace(base(), m ? [focus(m)] : [], START, S2))
    expect([text(0), text(2), text(59), text(60), text(90)]).toEqual(['0 h', '2 min', '59 min', '1 h', '1.5 h'])
  })
  it('session lengths are not focus: only the finished focus blocks count toward the hours', () => {
    const sessions = [session('s1', '2026-10-06T21:10:00', 90, 'solved'), session('s2', '2026-10-07T21:10:00', 30, 'gave_up')]
    expect(sessions).toHaveLength(2)
    expect(pace(base(), [], START, S2).hours).toBe(0)
    expect(pace(base(), [{ t: 'rung', id: 'p1', at: ist('2026-10-06T21:10:00'), rung: 2, cost: 2 }], START, S2).hours).toBe(0)
  })
  it('UAT J3: no projected finish until there is a week of data (not "S650" on day 1)', () => {
    const day1 = done(base(), ['a1'], '2026-10-05T10:00:00')
    expect(pace(day1, [], START, ist('2026-10-05T18:00:00')).finishSprint).toBeNull()
    expect(pace(day1, [], START, ist('2026-10-11T18:00:00')).finishSprint).toBeNull()
    expect(pace(day1, [], START, ist('2026-10-12T09:00:00')).finishSprint).toBe(6)
    // a week since the plan start is not enough: the week counts from the first finished card
    const late = done(base(), ['a1'], '2026-10-20T10:00:00')
    expect(pace(late, [], START, ist('2026-10-21T10:00:00')).finishSprint).toBeNull()
    expect(pace(late, [], START, ist('2026-10-27T10:00:00')).finishSprint).toBe(12)
  })
  it('before start: nothing expected, no projection (Review Focus #5)', () => {
    const p = pace(base(), [], START, ist('2026-10-01T10:00:00'))
    expect(p.rows.every(r => r.expected === 0 && r.verdict === 'on')).toBe(true)
    expect(p.finishSprint).toBeNull()
  })
  it('after the plan window with nothing done: expected saturates, no projection (A5)', () => {
    const p = pace(base(), [], START, ist('2030-01-01T10:00:00'))
    expect(p.finishSprint).toBeNull()
    expect(p.rows.every(r => r.verdict === 'behind' || r.expected === 0)).toBe(true)
  })
})

describe('outcomesBySprint', () => {
  it('buckets by session start, contiguous from S1, drops pre-start sessions', () => {
    const sessions = [
      session('a', '2026-10-18T23:50:00', 25, 'solved'),
      session('b', '2026-10-19T00:10:00', 25, 'gave_up'),
      session('c', '2026-10-25T21:10:00', 25, 'solved_help'),
      session('d', '2026-10-01T21:10:00', 25, 'solved'),
    ]
    expect(outcomesBySprint(sessions, START)).toEqual([
      { sprint: 1, solved: 1, solved_help: 0, gave_up: 0 },
      { sprint: 2, solved: 0, solved_help: 1, gave_up: 1 },
    ])
    expect(outcomesBySprint([], START)).toEqual([])
  })

  it('with the tickets, a solved session counts only while its card is done; a gave-up attempt stays (cu-2 P3-16)', () => {
    const sessions = [
      session('a', '2026-10-06T21:10:00', 25, 'solved'),
      session('b', '2026-10-06T22:10:00', 25, 'gave_up'),
      { ...session('c', '2026-10-07T21:10:00', 25, 'solved_help'), ticketId: 'x1' },
    ]
    const cards = (st: 'done' | 'todo') => [mkTicket({ id: 'p1', status: st }), mkTicket({ id: 'x1', status: 'done' })]
    expect(outcomesBySprint(sessions, START, cards('done'))).toEqual([{ sprint: 1, solved: 1, solved_help: 1, gave_up: 1 }])
    // p1 unticked: its Solved goes, the give-up and the other card's session stay
    expect(outcomesBySprint(sessions, START, cards('todo'))).toEqual([{ sprint: 1, solved: 0, solved_help: 1, gave_up: 1 }])
    // without tickets the sessions are the whole story, as before
    expect(outcomesBySprint(sessions, START)).toEqual([{ sprint: 1, solved: 1, solved_help: 1, gave_up: 1 }])
  })
})


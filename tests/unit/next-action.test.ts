import { describe, expect, it } from 'vitest'
import { nextAction, pathWaitNote } from '../../src/rules/dayMix'
import type { PlanPhase } from '../../src/data/planV2'
import type { Lane, Ticket } from '../../src/data/types'
import { mkTicket } from '../helpers/tickets'

const BUDGETS = [90, 60, 60, 60, 30, 30, 150]
const MON = new Date(2026, 9, 12, 10, 0)
const THU = new Date(2026, 9, 15, 10, 0)
const phases = (authored2: boolean): PlanPhase[] => [
  { p: 1, name: 'Foundations', months: 'M1-M3', idea: 'i', authored: true },
  { p: 2, name: 'Serving', months: 'M4-M6', idea: 'j', authored: authored2 },
]
const tk = (id: string, lane: Lane, order: number, estMin: number, extra: Partial<Ticket> = {}): Ticket =>
  mkTicket({ id, lane, order, estMin, title: id, track: lane === 'path' ? 'ai' : 'interview', kind: lane === 'dsa' ? 'problem' : 'build', ...extra })
const act = (tickets: Ticket[], over: Partial<Parameters<typeof nextAction>[0]> = {}) =>
  nextAction({ tickets, date: MON, budgets: BUDGETS, careerLane: false, dueReviews: 0, phases: phases(true), ...over })

describe('nextAction', () => {
  it('1. a started ticket resumes, and the lowest effective order wins among several', () => {
    const r = act([tk('a', 'path', 9, 45, { status: 'doing' }), tk('b', 'dsa', 2, 30, { status: 'doing' }), tk('c', 'path', 1, 30)])
    expect(r).toMatchObject({ kind: 'resume', reason: 'you started this' })
    expect(r.kind === 'resume' && r.ticket.id).toBe('b')
  })

  it('a started Career ticket is not resumed while the lane is off, but is when it is on (TODAY-09, TODAY-10)', () => {
    const t = [tk('c1', 'career', 1, 30, { status: 'doing' }), tk('p1', 'path', 2, 30)]
    const off = act(t, { careerLane: false })
    expect(off.kind).toBe('start')
    expect(off.kind === 'start' && off.ticket.id).toBe('p1')
    const on = act(t, { careerLane: true })
    expect(on.kind === 'resume' && on.ticket.id).toBe('c1')
  })

  it('with the lane off and only a started Career ticket left, nothing is resumed and the queue reads as done (TODAY-09)', () => {
    const r = act([tk('c1', 'career', 1, 30, { status: 'doing' })], { careerLane: false })
    expect(r).toMatchObject({ kind: 'wait', ticket: null })
  })

  it('an archived Doing ticket is never resumed (Review Focus 1)', () => {
    const r = act([tk('gone', 'path', 1, 45, { status: 'doing', archived: true }), tk('d1', 'dsa', 2, 30)])
    expect(r.kind).toBe('start')
    expect(r.kind === 'start' && r.ticket.id).toBe('d1')
  })

  it('2. more than ten due reviews beat the queue; exactly ten do not (TODAY-05, TODAY-06)', () => {
    expect(act([tk('p1', 'path', 1, 45)], { dueReviews: 11 })).toMatchObject({ kind: 'review', count: 11 })
    expect(act([tk('p1', 'path', 1, 45)], { dueReviews: 10 }).kind).toBe('start')
    expect(act([tk('p1', 'path', 1, 45)], { dueReviews: 3, reviewThreshold: 2 }).kind).toBe('review')
  })

  it('a started ticket still beats many reviews', () => {
    expect(act([tk('p1', 'path', 1, 45, { status: 'doing' })], { dueReviews: 40 }).kind).toBe('resume')
  })

  it('3. otherwise the first mix item, with the estimate in the reason', () => {
    const r = act([tk('p1', 'path', 1, 45), tk('d1', 'dsa', 2, 30)])
    expect(r).toMatchObject({ kind: 'start', reason: 'next in your queue, about 45 min' })
    expect(r.kind === 'start' && r.ticket.id).toBe('p1')
  })

  it('a 75-minute build on a 30-minute Thursday starts the shortest fitting ticket (Review Focus 3)', () => {
    const r = act([tk('p1', 'path', 1, 75), tk('d1', 'dsa', 2, 30)], { date: THU })
    expect(r.kind === 'start' && r.ticket.id).toBe('d1')
  })

  it('4. nothing fits: reviews first when any are due, else the shortest next ticket (TODAY-14)', () => {
    const tickets = [tk('p1', 'path', 1, 75), tk('d1', 'dsa', 2, 90), tk('g1', 'design', 3, 120)]
    expect(act(tickets, { date: THU, dueReviews: 2 })).toMatchObject({ kind: 'review', count: 2 })
    const r = act(tickets, { date: THU, dueReviews: 0 })
    expect(r.kind === 'start' && r.ticket.id).toBe('p1')
  })

  it('a budget under 20 minutes: reviews if due, else the shortest next-per-lane ticket (TODAY-15)', () => {
    const budgets = [90, 60, 60, 60, 15, 30, 150]
    const tickets = [tk('p1', 'path', 1, 45), tk('d1', 'dsa', 2, 30)]
    expect(act(tickets, { date: THU, budgets, dueReviews: 4 }).kind).toBe('review')
    const r = act(tickets, { date: THU, budgets })
    expect(r.kind === 'start' && r.ticket.id).toBe('d1')
  })

  it('a rest day (0 minutes) does not crash', () => {
    expect(act([tk('p1', 'path', 1, 45)], { budgets: [0, 0, 0, 0, 0, 0, 0] }).kind).toBe('start')
  })

  it('an unauthored path phase shows the other lanes and never an error (Review Focus 1)', () => {
    const tickets = [tk('d1', 'dsa', 2, 30), tk('g1', 'design', 3, 45)]
    expect(act(tickets, { phases: phases(false) }).kind).toBe('start')
    expect(pathWaitNote(tickets, phases(false))).toBe('Phase 2 tickets are being written')
  })

  it('nothing can start: wait, and name what it waits on', () => {
    expect(act([], { phases: phases(false) })).toEqual({ kind: 'wait', ticket: null, reason: 'Phase 2 tickets are being written' })
    expect(act([tk('x', 'path', 1, 30, { status: 'done' })], { phases: phases(true) }))
      .toEqual({ kind: 'wait', ticket: null, reason: 'every ticket in your queue is done' })
  })

  it('career tickets count only when the lane is on', () => {
    const tickets = [tk('c1', 'career', 0, 30)]
    expect(act(tickets).kind).toBe('wait')
    expect(act(tickets, { careerLane: true }).kind).toBe('start')
  })
})

describe('pathWaitNote', () => {
  it('is null while the path lane has open tickets, or when every phase is authored', () => {
    expect(pathWaitNote([tk('p1', 'path', 1, 30)], phases(false))).toBeNull()
    expect(pathWaitNote([], phases(true))).toBeNull()
  })
  it('names the first phase that is not authored', () => {
    const ps: PlanPhase[] = [...phases(true), { p: 3, name: 'x', months: '', idea: '', authored: false }]
    expect(pathWaitNote([], [ps[2], ps[0], ps[1]])).toBe('Phase 3 tickets are being written')
  })
})

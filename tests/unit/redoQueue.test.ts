import { describe, expect, it } from 'vitest'
import type { DesignSession, Redo, Session } from '../../src/data/types'
import {
  designRedoRows, displayTitle, givenUpText, isRedoDue, outcomeFeedback, redoBannerText, redoOutcome, redoRows,
  refundWaiting,
} from '../../src/rules/redoQueue'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const mkRedo = (p: Partial<Redo> = {}): Redo => ({
  id: 'r1', ticketId: 'p200', source: 'gave_up', createdAt: ist('2026-10-06T21:20:00'), stage: 0,
  due: ist('2026-10-09T21:20:00'), passed: [], helpCost: 10, refunded: 0, ...p,
})
const input = (p: Partial<Parameters<typeof redoOutcome>[0]>) => ({
  live: null, redoSession: false, outcome: 'gave_up' as const, deepestRung: 1, helpCost: 10,
  end: ist('2026-10-06T21:20:00'), ticketId: 'p200', newRedoId: 'r-new', ...p,
})

describe('redoOutcome, non-redo sessions', () => {
  it('Give up creates stage 0 due +3 local days with C = the session spend (H-25)', () => {
    const e = redoOutcome(input({}))
    expect(e).toMatchObject({ kind: 'created', days: 3 })
    if (e.kind !== 'created') throw new Error()
    expect(e.redo).toEqual({ id: 'r-new', ticketId: 'p200', source: 'gave_up', createdAt: ist('2026-10-06T21:20:00'), stage: 0, due: ist('2026-10-09T21:20:00'), passed: [], helpCost: 10, refunded: 0 })
  })
  it('Solved with help schedules only when the deepest rung is ≥ 3 (H-16, H-26)', () => {
    expect(redoOutcome(input({ outcome: 'solved_help', deepestRung: 2 })).kind).toBe('none')
    expect(redoOutcome(input({ outcome: 'solved_help', deepestRung: 3, helpCost: 5 }))).toMatchObject({ kind: 'created', redo: { source: 'solved_help', helpCost: 5 } })
    expect(redoOutcome(input({ outcome: 'solved', deepestRung: 1 })).kind).toBe('none')
  })
  it('a qualifying non-redo session resets a live redo to stage 0 (H-34)', () => {
    const live = mkRedo({ stage: 1, refunded: 5, passed: [true], due: ist('2026-10-19T00:01:00') })
    const e = redoOutcome(input({ live, helpCost: 5, end: ist('2026-10-12T21:00:00') }))
    expect(e).toMatchObject({ kind: 'reset', redo: { id: 'r1', stage: 0, due: ist('2026-10-15T21:00:00'), helpCost: 5, refunded: 0, passed: [] } })
  })
})

describe('redoOutcome, redo sessions', () => {
  const end = ist('2026-10-09T00:05:00')
  it('stage 0 pass refunds floor(C/2), moves to stage 1, due +10 d (H-28)', () => {
    const e = redoOutcome(input({ live: mkRedo(), redoSession: true, outcome: 'solved', deepestRung: 1, end }))
    expect(e).toMatchObject({ kind: 'pass', refund: 5, complete: false, stageBefore: 0, redo: { stage: 1, refunded: 5, passed: [true], due: ist('2026-10-19T00:05:00') } })
  })
  it('stage 1 pass refunds the rest, due +30 d (H-29)', () => {
    const e = redoOutcome(input({ live: mkRedo({ stage: 1, refunded: 5, passed: [true] }), redoSession: true, outcome: 'solved', end }))
    expect(e).toMatchObject({ kind: 'pass', refund: 5, redo: { stage: 2, refunded: 10, due: ist('2026-11-08T00:05:00') } })
  })
  it('stage 2 pass pays +3 and closes the redo (H-30)', () => {
    const e = redoOutcome(input({ live: mkRedo({ stage: 2, refunded: 10 }), redoSession: true, outcome: 'solved', end }))
    expect(e).toMatchObject({ kind: 'pass', refund: 3, complete: true, redo: { closedAt: end } })
  })
  it('a pass with only a hint (deepest 2) still passes (H-31)', () => {
    expect(redoOutcome(input({ live: mkRedo(), redoSession: true, outcome: 'solved_help', deepestRung: 2, end })).kind).toBe('pass')
  })
  it('a fail keeps the stage and reschedules by that stage (H-32, H-33)', () => {
    expect(redoOutcome(input({ live: mkRedo(), redoSession: true, outcome: 'solved_help', deepestRung: 3, end })))
      .toMatchObject({ kind: 'fail', days: 3, stageBefore: 0, redo: { stage: 0, passed: [false], due: ist('2026-10-12T00:05:00'), helpCost: 10 } })
    expect(redoOutcome(input({ live: mkRedo({ stage: 1 }), redoSession: true, outcome: 'gave_up', end })))
      .toMatchObject({ kind: 'fail', days: 10, redo: { stage: 1 } })
  })
})

describe('due-ness and drawer rows', () => {
  it('is due by local date, never once closed (H-25)', () => {
    expect(isRedoDue(mkRedo(), ist('2026-10-08T23:59:00'))).toBe(false)
    expect(isRedoDue(mkRedo(), ist('2026-10-09T00:01:00'))).toBe(true)
    expect(isRedoDue(mkRedo({ closedAt: 1 }), ist('2026-12-31T00:00:00'))).toBe(false)
  })
  it('refundWaiting is floor(C/2), then the rest, then 3', () => {
    expect(refundWaiting(mkRedo({ helpCost: 5 }))).toBe(2)
    expect(refundWaiting(mkRedo({ stage: 1, refunded: 5 }))).toBe(5)
    expect(refundWaiting(mkRedo({ stage: 2 }))).toBe(3)
  })
  it('rows: display title, days since the first session, refund waiting, sorted by due (H-25, H-38)', () => {
    const tickets = [
      mkTicket({ id: 'p200', kind: 'problem', title: '200 · Number of Islands' }),
      mkTicket({ id: 'p543', kind: 'problem', title: '543 · Diameter of Binary Tree' }),
    ]
    const sessions: Session[] = [
      { id: 's1', ticketId: 'p200', start: ist('2026-10-06T21:10:00'), end: ist('2026-10-06T21:20:00'), minutes: 10, outcome: 'gave_up', xpDelta: 0 },
    ]
    const redos = [mkRedo(), mkRedo({ id: 'r2', ticketId: 'p543', helpCost: 5, due: ist('2026-10-09T09:00:00'), createdAt: ist('2026-10-06T21:30:00') }), mkRedo({ id: 'r3', ticketId: 'p1', due: ist('2026-10-20T00:00:00') })]
    const rows = redoRows(redos, tickets, sessions, ist('2026-10-09T00:01:00'))
    expect(rows.map(r => r.ticketId)).toEqual(['p543', 'p200'])
    expect(rows[1]).toEqual({
      ticketId: 'p200', title: 'Number of Islands', days: 3, refund: 5,
      text: 'Number of Islands · 3d since first try · +5 xp waiting', to: '/do/p200',
    })
    expect(rows[0].text).toBe('Diameter of Binary Tree · 3d since first try · +2 xp waiting')
    expect(rows[0].to).toBe('/do/p543')
  })
})

describe('designRedoRows (Today Redo drawer, due redesigns)', () => {
  const design = (id: string, title: string) => ({
    id, title, tier: 1, tierName: 'Foundations', tierLabel: 'Foundations', tierShort: 'Foundations', order: 0,
    difficulty: 'M' as const, deepDives: [], refs: [],
  })
  const doneSession = (p: Partial<DesignSession> = {}): DesignSession => ({
    id: 'ds1', designId: 'd-ratelimit', at: ist('2026-09-01T10:00:00'), phase: 'done', minutes: 45, mode: 'solo',
    view: '2d', canvas: { layout: 'layered', nodes: [], links: [], zones: [], flows: [] },
    close: { tradeoff: { chose: '', over: '', because: '' }, breaksAt10x: '', dataOwnership: '', couldNotAnswer: 0, readNext: '' },
    deepDives: [], tradeoffs: [], rubric: 12, lenses: {}, redesignDue: ist('2026-10-01T00:00:00'), ...p,
  })

  it('C-INT §7: lists only redesigns already due, text `{title} · redesign · previous rubric {n}/20`, to the design session', () => {
    const designs = [design('d-ratelimit', 'Distributed rate limiter and API gateway')]
    const queued = doneSession({ id: 'ds-queued', designId: 'd-ratelimit', redesignDue: ist('2026-12-01T00:00:00') })
    const due = doneSession({ id: 'ds-due', redesignDue: ist('2026-10-01T00:00:00') })
    const rows = designRedoRows(designs, [queued, due], ist('2026-10-11T00:00:00'))
    expect(rows).toEqual([{
      designId: 'd-ratelimit', title: 'Distributed rate limiter and API gateway', due: ist('2026-10-01T00:00:00'),
      text: 'Distributed rate limiter and API gateway · redesign · previous rubric 12/20', to: '/designs/session/d-ratelimit',
    }])
  })

  it('C-INT §7: redesign rows are ordered by due date', () => {
    const designs = [design('d-a', 'A design'), design('d-b', 'B design')]
    const later = doneSession({ id: 'ds-b', designId: 'd-b', redesignDue: ist('2026-10-05T00:00:00') })
    const sooner = doneSession({ id: 'ds-a', designId: 'd-a', redesignDue: ist('2026-10-02T00:00:00') })
    expect(designRedoRows(designs, [later, sooner], ist('2026-10-11T00:00:00')).map(r => r.designId)).toEqual(['d-a', 'd-b'])
  })
})

describe('texts and feedback', () => {
  it('display title, given-up line, banner', () => {
    expect(displayTitle({ kind: 'problem', title: '200 · Number of Islands' })).toBe('Number of Islands')
    expect(displayTitle({ kind: 'design', title: 'The method, on a whiteboard, in 45 minutes' })).toBe('The method, on a whiteboard, in 45 minutes')
    expect(givenUpText(ist('2026-10-09T21:20:00'))).toBe('Given up · redo due Oct 9')
    expect(redoBannerText(1)).toBe('Redo · stage 2 of 3 · Picture, Video and Solution cost double')
  })
  it('outcome feedback per C-LADDER §2.3/§2.4', () => {
    const redo = mkRedo()
    expect(outcomeFeedback({ kind: 'none' }, 'solved', 10)).toEqual({ text: '+10 xp · Saved', tone: 'ok', flash: true, powerUp: true })
    expect(outcomeFeedback({ kind: 'none' }, 'solved_help', 8)).toEqual({ text: '+8 xp · Saved', tone: 'help', flash: true, powerUp: false })
    expect(outcomeFeedback({ kind: 'created', redo, days: 3 }, 'gave_up', 0)).toEqual({ text: 'Logged. Redo in 3 days.', tone: 'help', flash: false, powerUp: false })
    expect(outcomeFeedback({ kind: 'pass', redo, refund: 5, complete: false, stageBefore: 0 }, 'solved', 5)).toEqual({ text: '+5 xp refunded', tone: 'ok', flash: true, powerUp: true, powerUpMs: 2500 })
    expect(outcomeFeedback({ kind: 'pass', redo, refund: 3, complete: true, stageBefore: 2 }, 'solved', 3).text).toBe('+3 xp bonus · redo complete')
    expect(outcomeFeedback({ kind: 'fail', redo, days: 3, stageBefore: 0 }, 'solved_help', 0)).toEqual({ text: 'Not yet. Redo again in 3 days.', tone: 'help', flash: false, powerUp: false })
  })
})

describe('a check-created redo stores a local date string (briefs Addendum 1 Q6)', () => {
  it('dueMs reads both forms and isRedoDue follows the local date', async () => {
    const { dueMs } = await import('../../src/rules/redoQueue')
    expect(dueMs(5)).toBe(5)
    expect(dueMs('2026-10-09')).toBe(new Date(2026, 9, 9).getTime())
    const r = mkRedo({ due: '2026-10-09' })
    expect(isRedoDue(r, ist('2026-10-08T23:59:00'))).toBe(false)
    expect(isRedoDue(r, ist('2026-10-09T00:30:00'))).toBe(true)
  })
})

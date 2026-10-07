import { describe, expect, it } from 'vitest'
import {
  canMove, cardMeta, columnOf, debtBar, doingCount, MOVE_MESSAGES, shortSource, sprintColumns, stepColumn, stripLength,
} from '../../src/rules/board'
import type { Ticket } from '../../src/data/types'
import { mkTicket, smallTickets } from '../helpers/tickets'

const ids = (ts: Ticket[]) => ts.map(t => t.id)
const withStatus = (ts: Ticket[], status: Ticket['status'], which: string[]) =>
  ts.map(t => (which.includes(t.id) ? { ...t, status } : t))

describe('columns', () => {
  it('derives the column from status and slidFrom', () => {
    expect(columnOf(mkTicket({ id: 'a' }))).toBe('todo')
    expect(columnOf(mkTicket({ id: 'a', slidFrom: [1] }))).toBe('slid')
    expect(columnOf(mkTicket({ id: 'a', slidFrom: [1], status: 'doing' }))).toBe('doing')
    expect(columnOf(mkTicket({ id: 'a', status: 'done' }))).toBe('done')
  })
  it('groups a sprint in plan order and hides archived tickets', () => {
    const ts = smallTickets().map(t => (t.id === 'p1' ? { ...t, archived: true } : t))
    const cols = sprintColumns(withStatus(ts, 'done', ['p200']), 1)
    expect(ids(cols.todo)).toEqual(['m1w1t1', 'm1w1i1', 'p127'])
    expect(ids(cols.done)).toEqual(['p200'])
    expect(cols.slid).toEqual([])
  })
})

describe('Doing cap (Review Focus #5)', () => {
  // the limit is per sprint (ruling 25 R2): the three Doing cards share Sprint 1
  const three = withStatus(smallTickets(), 'doing', ['m1w1t1', 'm1w2t1', 'm1w3t1']).map(t => (['m1w1t1', 'm1w2t1', 'm1w3t1'].includes(t.id) ? { ...t, sprint: 1 } : t))
  it('counts the Doing cards of one sprint', () => {
    expect(doingCount(three, 1)).toBe(3)
    expect(doingCount(three, 2)).toBe(0)
  })
  it('is per sprint (ruling 25 R2): Doing cards of other sprints do not fill this one', () => {
    // three Doing cards sit in Sprint 2; a Sprint 1 card can still go to Doing, and a 4th Sprint 2 card cannot
    const elsewhere = three.map(t => (['m1w1t1', 'm1w2t1', 'm1w3t1'].includes(t.id) ? { ...t, sprint: 2 } : t))
    expect(canMove(elsewhere, 'p127', 'doing')).toEqual({ ok: true })
    const four = elsewhere.map(t => (t.id === 'p200' ? { ...t, sprint: 2 } : t))
    expect(canMove(four, 'p200', 'doing')).toEqual({ ok: false, reason: 'doing_full' })
  })
  it('rejects a 4th ticket into Doing', () => {
    expect(canMove(three, 'p127', 'doing')).toEqual({ ok: false, reason: 'doing_full' })
    expect(MOVE_MESSAGES.doing_full.startsWith('Doing is full (3/3)')).toBe(true)
  })
  it('does not count archived tickets toward the cap', () => {
    const ts = three.map(t => (t.id === 'm1w3t1' ? { ...t, archived: true } : t))
    expect(canMove(ts, 'p127', 'doing')).toEqual({ ok: true })
  })
  it('treats moves to the current column as no-ops and refuses the Slid in column', () => {
    expect(canMove(three, 'm1w1t1', 'doing')).toEqual({ ok: false, reason: 'same' })
    expect(canMove(three, 'p127', 'slid')).toEqual({ ok: false, reason: 'slid_column' })
    expect(canMove(three, 'nope', 'done')).toEqual({ ok: false, reason: 'missing' })
    expect(canMove(three, 'p127', 'done')).toEqual({ ok: true })
  })
  it('a drop on Slid in: refused for a card from another column, silent for one already there (ruling 25 R5)', () => {
    const ts = [...smallTickets().map(t => (t.id === 'm1w1t1' ? { ...t, slidFrom: [1], sprint: 2 } : t))]
    expect(canMove(ts, 'm1w1t1', 'slid')).toEqual({ ok: false, reason: 'same' }) // a reorder inside Slid in: nothing, no toast
    expect(MOVE_MESSAGES.same).toBe('')
    expect(canMove(ts, 'p127', 'slid')).toEqual({ ok: false, reason: 'slid_column' }) // from Todo: still refused, with the toast
    const doing = ts.map(t => (t.id === 'm1w1t1' ? { ...t, status: 'doing' as const } : t))
    expect(canMove(doing, 'm1w1t1', 'slid')).toEqual({ ok: false, reason: 'slid_column' }) // a slid card in Doing is in Doing
  })
  it('steps columns for keyboard moves', () => {
    expect(stepColumn(mkTicket({ id: 'a' }), 1)).toBe('doing')
    expect(stepColumn(mkTicket({ id: 'a', slidFrom: [1] }), 1)).toBe('doing')
    expect(stepColumn(mkTicket({ id: 'a', status: 'doing' }), 1)).toBe('done')
    expect(stepColumn(mkTicket({ id: 'a', status: 'done' }), 1)).toBe('done')
    expect(stepColumn(mkTicket({ id: 'a', status: 'doing' }), -1)).toBe('todo')
    expect(stepColumn(mkTicket({ id: 'a' }), -1)).toBe('todo')
  })
})

describe('debt bar, strip, card text', () => {
  it('counts own vs slid-in tickets against the plan average', () => {
    const ts = smallTickets().map(t => (t.id === 'm1w1t1' ? { ...t, sprint: 2, slidFrom: [1] } : t))
    expect(debtBar(ts, 2)).toEqual({ own: 3, slidIn: 1, avg: 0 })
    const many = Array.from({ length: 533 }, (_, i) => mkTicket({ id: `t${i}` }))
    expect(debtBar(many, 1).avg).toBe(7)
  })
  it('keeps 72 strip cells and grows when shift-plan overflows', () => {
    expect(stripLength(smallTickets())).toBe(72)
    expect(stripLength([mkTicket({ id: 'a', sprint: 73 })])).toBe(73)
  })
  it('shortens source labels and formats card metadata', () => {
    expect(shortSource('Anthropic Academy: Claude with the Anthropic API (free)')).toBe('Anthropic Academy')
    expect(shortSource('Karpathy · Zero to Hero (course)')).toBe('Karpathy')
    // UAT r3 J7: never cut mid-word ("Tech Interview Handboo"); CSS ellipsises a name too long for its row
    expect(shortSource('3Blue1Brown linear algebra')).toBe('3Blue1Brown linear algebra')
    expect(shortSource('Tech Interview Handbook: Grind 75')).toBe('Tech Interview Handbook')
    expect(cardMeta(mkTicket({ id: 'a', sprint: 12, estMin: 25 }))).toBe('S12 · 25 min')
    expect(cardMeta(mkTicket({ id: 'a', sprint: 12, estMin: 25, slidFrom: [10, 11] }))).toBe('S12 · 25 min · from S11')
  })
})

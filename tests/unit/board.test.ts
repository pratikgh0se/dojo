import { describe, expect, it } from 'vitest'
import { canMove, columnOf, MOVE_MESSAGES, rowMeta, shortSource } from '../../src/rules/board'
import type { Ticket } from '../../src/data/types'
import { mkTicket } from '../helpers/tickets'

const withStatus = (ts: Ticket[], status: Ticket['status'], which: string[]) =>
  ts.map(t => (which.includes(t.id) ? { ...t, status } : t))

describe('columns', () => {
  it('derives the column from status and slidFrom', () => {
    expect(columnOf(mkTicket({ id: 'a' }))).toBe('todo')
    expect(columnOf(mkTicket({ id: 'a', slidFrom: [1] }))).toBe('slid')
    expect(columnOf(mkTicket({ id: 'a', slidFrom: [1], status: 'doing' }))).toBe('doing')
    expect(columnOf(mkTicket({ id: 'a', status: 'done' }))).toBe('done')
  })
})

describe('Doing is a soft cap (flat queue)', () => {
  const base = ['a', 'b', 'c', 'd'].map(id => mkTicket({ id }))
  const three = withStatus(base, 'doing', ['a', 'b', 'c'])
  it('never refuses a fourth ticket into Doing', () => {
    expect(canMove(three, 'd', 'doing')).toEqual({ ok: true })
  })
  it('treats moves to the current column as no-ops and refuses the Slid in column', () => {
    expect(canMove(three, 'a', 'doing')).toEqual({ ok: false, reason: 'same' })
    expect(canMove(three, 'd', 'slid')).toEqual({ ok: false, reason: 'slid_column' })
    expect(canMove(three, 'nope', 'done')).toEqual({ ok: false, reason: 'missing' })
    expect(canMove(three, 'd', 'done')).toEqual({ ok: true })
  })
  it('a drop on Slid in: refused for a card from another column, silent for one already there (ruling 25 R5)', () => {
    const ts = base.map(t => (t.id === 'a' ? { ...t, slidFrom: [1], sprint: 2 } : t))
    expect(canMove(ts, 'a', 'slid')).toEqual({ ok: false, reason: 'same' }) // a reorder inside Slid in: nothing, no toast
    expect(MOVE_MESSAGES.same).toBe('')
    expect(canMove(ts, 'd', 'slid')).toEqual({ ok: false, reason: 'slid_column' }) // from Todo: still refused, with the toast
    const doing = ts.map(t => (t.id === 'a' ? { ...t, status: 'doing' as const } : t))
    expect(canMove(doing, 'a', 'slid')).toEqual({ ok: false, reason: 'slid_column' }) // a slid card in Doing is in Doing
  })
  it('an archived ticket is missing', () => {
    expect(canMove(base.map(t => (t.id === 'a' ? { ...t, archived: true } : t)), 'a', 'doing')).toEqual({ ok: false, reason: 'missing' })
  })
})

describe('source and row text', () => {
  it('shortens source labels', () => {
    expect(shortSource('Anthropic Academy: Claude with the Anthropic API (free)')).toBe('Anthropic Academy')
    expect(shortSource('Karpathy · Zero to Hero (course)')).toBe('Karpathy')
    // UAT r3 J7: never cut mid-word ("Tech Interview Handboo"); CSS ellipsises a name too long for its row
    expect(shortSource('3Blue1Brown linear algebra')).toBe('3Blue1Brown linear algebra')
    expect(shortSource('Tech Interview Handbook: Grind 75')).toBe('Tech Interview Handbook')
  })
  it('formats the row meta', () => {
    expect(rowMeta(mkTicket({ id: 'a', sprint: 12 }))).toBe('S12')
    expect(rowMeta(mkTicket({ id: 'a', sprint: 12, slidFrom: [10, 11] }))).toBe('S12 · from S11')
  })
})

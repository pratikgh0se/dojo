import { describe, expect, it } from 'vitest'
import {
  nextSlideTarget, shiftPlan, slideSprint, slideSprintPreview, slideTicket, undoableEvents, undoEvent, UNDO_DEPTH,
} from '../../src/rules/slide'
import type { StoredEvent, Ticket } from '../../src/data/types'
import { mkTicket, smallTickets } from '../helpers/tickets'

const get = (ts: Ticket[], id: string) => ts.find(t => t.id === id)!

describe('slideTicket', () => {
  it('moves a ticket forward, records where it came from, and emits one slide event', () => {
    const t = mkTicket({ id: 'a', sprint: 1, status: 'doing' })
    const r = slideTicket(t, 2, 99, 1)
    expect(r).toEqual({
      ok: true,
      ticket: { ...t, sprint: 2, slidFrom: [1], status: 'todo' },
      event: { t: 'slide', id: 'a', at: 99, from: 1, to: 2, reason: 'manual' },
    })
  })
  it('refuses done tickets, backwards moves, and no-op moves', () => {
    expect(slideTicket(mkTicket({ id: 'a', status: 'done' }), 2, 0, 1)).toEqual({ ok: false, reason: 'done' })
    expect(slideTicket(mkTicket({ id: 'a', sprint: 3 }), 1, 0, 2)).toEqual({ ok: false, reason: 'backwards' })
    expect(slideTicket(mkTicket({ id: 'a', sprint: 3 }), 3, 0, 1)).toEqual({ ok: false, reason: 'same' })
  })
  it('targets the next sprint, never before the current one', () => {
    expect(nextSlideTarget(mkTicket({ id: 'a', sprint: 1 }), 1)).toBe(2)
    expect(nextSlideTarget(mkTicket({ id: 'a', sprint: 1 }), 5)).toBe(5)
  })
  it('pulling a ticket to an earlier sprint does not push slidFrom or land it in Slid in (minor #5)', () => {
    const t = mkTicket({ id: 'a', sprint: 5, status: 'todo' })
    const r = slideTicket(t, 3, 99, 1)
    expect(r).toEqual({
      ok: true,
      ticket: { ...t, sprint: 3, slidFrom: [], status: 'todo' },
      event: { t: 'slide', id: 'a', at: 99, from: 5, to: 3, reason: 'manual' },
    })
    if (r.ok) expect(r.ticket.slidFrom.length).toBe(0)
  })
})

describe('slideSprint / shiftPlan', () => {
  const ts = smallTickets().map(t => (t.id === 'p1' ? { ...t, status: 'done' as const } : t))

  it('slides every unfinished ticket of a sprint with ONE event', () => {
    const r = slideSprint(ts, 1, 50, 1)
    expect(r.tickets.map(t => t.id)).toEqual(['m1w1t1', 'm1w1i1', 'p200', 'p127'])
    expect(r.tickets.every(t => t.sprint === 2 && t.slidFrom.join() === '1' && t.status === 'todo')).toBe(true)
    expect(r.event).toEqual({ t: 'slide_sprint', at: 50, sprint: 1, to: 2, count: 4, ids: ['m1w1t1', 'm1w1i1', 'p200', 'p127'] })
  })
  it('slides a past sprint straight to the current one', () => {
    expect(slideSprint(ts, 1, 50, 3).event.to).toBe(3)
  })
  it('previews the count and the resulting size of the target sprint', () => {
    expect(slideSprintPreview(ts, 1, 1)).toEqual({ count: 4, to: 2, resultingSize: 7 })
  })
  it('resultingSize counts plan tickets only, ignoring a bank/mine ticket already sitting at the target sprint', () => {
    const withBank = [...ts, mkTicket({ id: 'bank:blind75:p1', origin: 'bank:blind75', sprint: 2, status: 'done' })]
    expect(slideSprintPreview(withBank, 1, 1)).toEqual({ count: 4, to: 2, resultingSize: 7 })
  })
  it('shifts every unfinished ticket from a sprint onward by one, with ONE event', () => {
    const r = shiftPlan(ts, 2, 60)
    expect(r.tickets.map(t => [t.id, t.sprint])).toEqual([['m1w2t1', 3], ['m1w2i1', 3], ['m1w3t1', 4], ['d-method', 3], ['d-estimate', 4]])
    expect(r.tickets.every(t => t.slidFrom.length === 0)).toBe(true)
    expect(r.event).toEqual({
      t: 'shift_plan', at: 60, fromSprint: 2, ids: ['m1w2t1', 'm1w2i1', 'm1w3t1', 'd-method', 'd-estimate'],
      to: { m1w2t1: 3, m1w2i1: 3, m1w3t1: 4, 'd-method': 3, 'd-estimate': 4 },
    })
  })
})

describe('undo', () => {
  it('reverses a slide, a slide sprint, and a shift plan', () => {
    const base = smallTickets()
    const s = slideTicket(get(base, 'm1w1t1'), 2, 1, 1)
    if (!s.ok) throw new Error('slide failed')
    expect(undoEvent([s.ticket], s.event)).toEqual([{ ...s.ticket, sprint: 1, slidFrom: [] }])

    const ss = slideSprint(base, 1, 2, 1)
    const after = base.map(t => ss.tickets.find(x => x.id === t.id) ?? t)
    const back = undoEvent(after, ss.event)
    expect(back.map(t => [t.id, t.sprint, t.slidFrom.length])).toEqual(ss.event.ids.map(id => [id, 1, 0]))

    const sp = shiftPlan(base, 2, 3)
    const shifted = base.map(t => sp.tickets.find(x => x.id === t.id) ?? t)
    expect(undoEvent(shifted, sp.event).map(t => t.sprint)).toEqual([2, 2, 3, 2, 3])
  })
  it('skips a shift-plan ticket that was slid again since, but restores the others', () => {
    const base = smallTickets()
    const sp = shiftPlan(base, 2, 3)
    const shifted = base.map(t => sp.tickets.find(x => x.id === t.id) ?? t)
    const movedAgain = get(shifted, 'm1w2t1')
    const slid = slideTicket(movedAgain, 5, 10, 1)
    if (!slid.ok) throw new Error('slide failed')
    const withReslide = shifted.map(t => (t.id === slid.ticket.id ? slid.ticket : t))
    const back = undoEvent(withReslide, sp.event)
    const byId = new Map(back.map(t => [t.id, t]))
    expect(byId.has('m1w2t1')).toBe(false)
    expect(byId.get('m1w2i1')?.sprint).toBe(2)
    expect(byId.get('m1w3t1')?.sprint).toBe(3)
    expect(byId.get('d-method')?.sprint).toBe(2)
    expect(byId.get('d-estimate')?.sprint).toBe(3)
  })
  it('skips tickets that were finished or moved since', () => {
    const t = mkTicket({ id: 'a', sprint: 2, slidFrom: [1], status: 'done' })
    expect(undoEvent([t], { t: 'slide', id: 'a', at: 0, from: 1, to: 2, reason: 'manual' })).toEqual([])
    const moved = mkTicket({ id: 'a', sprint: 4, slidFrom: [1, 2] })
    expect(undoEvent([moved], { t: 'slide', id: 'a', at: 0, from: 1, to: 2, reason: 'manual' })).toEqual([])
  })
  it('offers only the 20 most recent slide events, newest first, minus undone ones', () => {
    const slides: StoredEvent[] = Array.from({ length: 21 }, (_, i) => ({
      t: 'slide', id: 'a', at: i, from: i + 1, to: i + 2, reason: 'manual', seq: i + 1,
    }))
    const tick: StoredEvent = { t: 'tick', id: 'b', at: 0, xp: 10, seq: 100 }
    const stack = undoableEvents([...slides, tick])
    expect(stack).toHaveLength(UNDO_DEPTH)
    expect(stack[0].seq).toBe(21)
    expect(stack[19].seq).toBe(2)
    const undone: StoredEvent[] = Array.from({ length: 20 }, (_, i) => ({ t: 'undo', at: 0, of: 21 - i, seq: 200 + i }))
    expect(undoableEvents([...slides, ...undone])).toEqual([])
  })
})

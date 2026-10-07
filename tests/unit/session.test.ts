import { describe, expect, it } from 'vitest'
import { closeSessionResult } from '../../src/rules/session'
import { attributeSession } from '../../src/rules/sprint'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const NOW = ist('2026-09-14T22:00:00')
const p127 = mkTicket({ id: 'p127', track: 'interview', kind: 'problem', difficulty: 'H', status: 'doing' })

describe('closeSessionResult', () => {
  it('Solved pays full XP, marks done, and emits a tick', () => {
    const r = closeSessionResult({ ticket: p127, outcome: 'solved', sessionStart: NOW - 50 * 60_000, now: NOW, notes: ' BFS ', sessionId: 's1' })
    expect(r.ticket).toMatchObject({ status: 'done', xp: 15, doneAt: NOW, doneAtApprox: false })
    expect(r.session).toEqual({ id: 's1', ticketId: 'p127', start: NOW - 50 * 60_000, end: NOW, minutes: 50, outcome: 'solved', xpDelta: 15, notes: 'BFS' })
    expect(r.event).toEqual({ t: 'tick', id: 'p127', at: NOW, xp: 15 })
  })
  it('Solved with help also pays full XP in core', () => {
    const r = closeSessionResult({ ticket: p127, outcome: 'solved_help', sessionStart: NOW, now: NOW, sessionId: 's1' })
    expect(r.session).toMatchObject({ outcome: 'solved_help', xpDelta: 15, minutes: 0 })
    expect(r.session.notes).toBeUndefined()
  })
  it('Give up returns the ticket to todo with no XP or tick', () => {
    const r = closeSessionResult({ ticket: p127, outcome: 'gave_up', sessionStart: NOW - 10 * 60_000, now: NOW, sessionId: 's1' })
    expect(r.ticket.status).toBe('todo')
    expect(r.session).toMatchObject({ outcome: 'gave_up', xpDelta: 0, minutes: 10 })
    expect(r.event).toBeNull()
  })
  it('never pays twice for an already-done ticket', () => {
    const done = { ...p127, status: 'done' as const, xp: 15, doneAt: NOW - 1000 }
    const r = closeSessionResult({ ticket: done, outcome: 'solved', sessionStart: NOW, now: NOW, sessionId: 's1' })
    expect(r.ticket).toMatchObject({ status: 'done', xp: 15, doneAt: NOW - 1000 })
    expect(r.session.xpDelta).toBe(0)
    expect(r.event).toBeNull()
  })
  it('stores AI-track proof, self-certified', () => {
    const ai = mkTicket({ id: 'm1w2t1', status: 'doing' })
    const r = closeSessionResult({ ticket: ai, outcome: 'solved', sessionStart: NOW, now: NOW, proof: { repo: '  https://github.com/p/r  ', note: 'loss 1.98 after 2k steps' }, sessionId: 's1' })
    expect(r.ticket.proof).toEqual({ repo: 'https://github.com/p/r', note: 'loss 1.98 after 2k steps' })
    expect(r.session.xpDelta).toBe(10)
  })
  it('awards the given net XP (not the gross base) when the caller passes one, and the tick event matches it', () => {
    const r = closeSessionResult({ ticket: p127, outcome: 'solved_help', sessionStart: NOW, now: NOW, sessionId: 's1', net: 8 })
    expect(r.ticket).toMatchObject({ status: 'done', xp: 8 })
    expect(r.session.xpDelta).toBe(8)
    expect(r.event).toEqual({ t: 'tick', id: 'p127', at: NOW, xp: 8 })
  })
  it('keeps a midnight- and sprint-crossing session on its start day and sprint (Review Focus #3)', () => {
    const start = ist('2026-09-20T23:40:00')
    const end = ist('2026-09-21T00:30:00')
    const r = closeSessionResult({ ticket: p127, outcome: 'solved', sessionStart: start, now: end, sessionId: 's1' })
    expect(r.session.start).toBe(start)
    expect(r.session.minutes).toBe(50)
    expect(attributeSession(r.session.start, '2026-09-07')).toEqual({ dayKey: '2026-09-20', sprint: 1 })
    expect(r.ticket.doneAt).toBe(end)
  })
})

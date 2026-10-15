import { describe, expect, it } from 'vitest'
import { dailyMix, nextAction } from '../../src/rules/dayMix'
import type { DayMix } from '../../src/rules/dayMix'
import { questView, thenLine, todayHeading } from '../../src/rules/todayModel'
import { mkTicket, PHASES } from '../helpers/planV2'

const mix = (over: Partial<DayMix> = {}): DayMix => ({ budget: 60, items: [], floor: false, waitsForLongerDay: [], lanesDone: [], ...over })
const watch = mkTicket({ id: 'w', kind: 'watch', explain: ['Q1', 'Q2'], title: 'Watch: attention' })
const build = mkTicket({ id: 'b', kind: 'build', estMin: 75, title: 'Build: tokensim step 2' })
const base = { mix: mix(), pathNote: null, studyLeft: null, studyTicketId: null }

describe('questView', () => {
  it('starts the next ticket with VERB · OBJECT and a then line', () => {
    const v = questView({ ...base, action: { kind: 'start', ticket: watch, reason: 'next in your queue, about 30 min' } })
    expect(v).toMatchObject({ tone: 'start', button: 'START · WATCH', reason: 'next in your queue, about 30 min', waits: [] })
    expect(v.then).toBe('Two explain-it-simply questions, about 5 minutes, then Done.')
  })
  it('resumes with the time left when the session runs on that ticket', () => {
    const a = { kind: 'resume' as const, ticket: build, reason: 'you started this' }
    expect(questView({ ...base, action: a, studyLeft: '12:40', studyTicketId: 'b' }).button).toBe('RESUME · 12:40')
    expect(questView({ ...base, action: a, studyLeft: '12:40', studyTicketId: 'other' }).button).toBe('RESUME · BUILD')
    expect(questView({ ...base, action: a }).button).toBe('RESUME · BUILD')
  })
  it('offers the review count when reviews come first', () => {
    const v = questView({ ...base, action: { kind: 'review', count: 12, reason: '12 reviews are due' } })
    expect(v).toMatchObject({ tone: 'review', button: 'START · REVIEW', ticket: null })
  })
  it('has no start button when nothing can start, names the wait, and carries no ticket', () => {
    const v = questView({ ...base, mix: mix({ waitsForLongerDay: [build] }), action: { kind: 'wait', ticket: build, reason: 'the next ticket needs 75 minutes' } })
    expect(v.button).toBeNull()
    expect(v.ticket).toBeNull()
    expect(v.waits).toEqual([build])
  })
})

describe('Today lines', () => {
  it('passes the phase note through', () => {
    const v = questView({ ...base, pathNote: 'Phase 2 tickets are being written', action: { kind: 'start', ticket: watch, reason: 'x' } })
    expect(v.phaseNote).toBe('Phase 2 tickets are being written')
  })
  it('only asks explain questions on watch and read tickets', () => {
    expect(thenLine(build)).toBeNull()
    expect(thenLine(mkTicket({ id: 'r', kind: 'read', explain: ['Q'] }))).toBe('One explain-it-simply question, about 5 minutes, then Done.')
  })
  it('counts the day and names the phase', () => {
    const at = new Date(2026, 10, 12, 9).getTime()
    expect(todayHeading({ nowMs: at, startDate: '2026-11-02', phase: 1, phases: PHASES })).toEqual({ day: 11, phaseLine: 'Phase 1 of 6 · Measure before you optimise' })
    expect(todayHeading({ nowMs: at, startDate: '2026-12-01', phase: undefined, phases: PHASES })).toEqual({ day: null, phaseLine: '' })
    expect(todayHeading({ nowMs: at, startDate: '', phase: 9, phases: PHASES }).day).toBeNull()
  })
})

describe('questView with the real dailyMix and nextAction (TODAY-14, TODAY-15)', () => {
  const heads = (aiOrder = 1) => [
    mkTicket({ id: 'ai75', lane: 'path', title: 'AI 75', estMin: 75, order: aiOrder }),
    mkTicket({ id: 'dsa90', lane: 'dsa', title: 'DSA 90', estMin: 90, order: 2 }),
    mkTicket({ id: 'des120', lane: 'design', title: 'Design 120', estMin: 120, order: 3 }),
  ]
  const view = (tickets: ReturnType<typeof heads>, budget: number) => {
    const budgets = [budget, budget, budget, budget, budget, budget, budget]
    const date = new Date(2026, 9, 15, 9, 0)
    const args = { tickets, date, budgets, careerLane: false }
    return questView({
      mix: dailyMix(args), pathNote: null, studyLeft: null, studyTicketId: null,
      action: nextAction({ ...args, dueReviews: 0, phases: [] }),
    })
  }
  for (const budget of [30, 15]) {
    it(`never lists the quest ticket as the one that waits (budget ${budget}, every head too long)`, () => {
      const v = view(heads(), budget)
      expect(v.tone).toBe('start')
      expect(v.ticket?.id).toBe('ai75')
      expect(v.waits.map(w => w.id)).not.toContain(v.ticket?.id)
      expect(v.waits.map(w => w.id).sort()).toEqual(['dsa90', 'des120'].sort()) // TODAY-14: every other first-open ticket is named
    })
    it(`still names a different waiting head when the lowest-order one is not the quest (budget ${budget})`, () => {
      const t = heads()
      t[1].order = 0 // DSA 90 now comes first in order but AI 75 is the shortest
      const v = view(t, budget)
      expect(v.ticket?.id).toBe('ai75')
      expect(v.waits.map(w => w.id)).toContain('dsa90')
    })
  }
})

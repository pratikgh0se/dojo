import { describe, expect, it } from 'vitest'
import type { HelpRung, Kind } from '../../src/data/types'
import {
  applyCost, costKind, needsRedo, passesRedo, REDO_BONUS, REDO_DAYS, redoDue, redoRefund, rungCost,
} from '../../src/rules/ladder'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const RUNGS: HelpRung[] = [2, 3, 4, 5]
const costs = (kind: Kind, redo = false) => RUNGS.map(r => rungCost(kind, r, { redo }))

describe('rung costs (PLATFORM "Do"; ladder contract §2.1)', () => {
  it('prices each ticket kind', () => {
    expect(costs('problem')).toEqual([2, 3, 3, 5])
    expect(costs('design')).toEqual([3, 4, 3, 5])
    expect(costs('task')).toEqual([2, 2, 0, null])
    expect(costs('stage')).toEqual([2, 2, 0, null])
  })
  it('maps kinds to cost tables', () => {
    expect([costKind('problem'), costKind('design'), costKind('task'), costKind('stage')]).toEqual(['problem', 'design', 'task', 'task'])
  })
  it('doubles Picture, Video and Solution in a redo, never Hint', () => {
    expect(costs('problem', true)).toEqual([2, 6, 6, 10])
    expect(costs('design', true)).toEqual([3, 8, 6, 10])
    expect(costs('task', true)).toEqual([2, 4, 0, null])
  })
  it('halves a second approach Picture, rounding up (TRACKING §3)', () => {
    expect(rungCost('problem', 3, { secondApproach: true })).toBe(2)
    expect(rungCost('problem', 3, { redo: true, secondApproach: true })).toBe(3)
    expect(rungCost('problem', 2, { secondApproach: true })).toBe(2)
  })
})

describe('net XP floor (DATA "XP"; Review Focus #5)', () => {
  it('applies only what the ticket has', () => {
    expect(applyCost(10, 3)).toEqual({ xp: 7, applied: 3 })
    expect(applyCost(2, 3)).toEqual({ xp: 0, applied: 2 })
    expect(applyCost(0, 5)).toEqual({ xp: 0, applied: 0 })
    expect(applyCost(4, 0)).toEqual({ xp: 4, applied: 0 })
  })
})

describe('redo schedule (DATA "Redo schedule"; ladder contract §2.4)', () => {
  it('is due 3, 10, 30 local days after the session end', () => {
    expect(REDO_DAYS).toEqual([3, 10, 30])
    const end = ist('2026-10-06T21:10:00')
    expect(redoDue(end, 0)).toBe(ist('2026-10-09T21:10:00'))
    expect(redoDue(end, 1)).toBe(ist('2026-10-16T21:10:00'))
    expect(redoDue(end, 2)).toBe(ist('2026-11-05T21:10:00'))
  })
  it('refunds floor(C/2), then the rest, then a fixed +3 bonus', () => {
    expect(redoRefund(0, 10, 0)).toBe(5)
    expect(redoRefund(1, 10, 5)).toBe(5)
    expect(redoRefund(0, 5, 0)).toBe(2)
    expect(redoRefund(1, 5, 2)).toBe(3)
    expect(redoRefund(2, 5, 5)).toBe(REDO_BONUS)
    expect(REDO_BONUS).toBe(3)
  })
  it('never refunds more than the recorded help cost (Review Focus #5)', () => {
    expect(redoRefund(0, 0, 0)).toBe(0)
    expect(redoRefund(1, 10, 10)).toBe(0)
    expect(redoRefund(0, 10, 9)).toBe(1)
    expect(redoRefund(1, 4, 7)).toBe(0)
  })
  it('creates a redo on give-up or heavy help', () => {
    expect(needsRedo({ outcome: 'gave_up', deepestRung: 1 })).toBe(true)
    expect(needsRedo({ outcome: 'solved_help', deepestRung: 3 })).toBe(true)
    expect(needsRedo({ outcome: 'solved_help', deepestRung: 2 })).toBe(false)
    expect(needsRedo({ outcome: 'solved', deepestRung: 1 })).toBe(false)
    // the design redesign rule (rubric < 14 or a deep dive at 0) belongs to chain D (C-DESIGN D-45)
  })
  it('passes a redo when solved with the deepest rung at Hint or above it', () => {
    expect(passesRedo({ outcome: 'solved', deepestRung: 1 })).toBe(true)
    expect(passesRedo({ outcome: 'solved_help', deepestRung: 2 })).toBe(true)
    expect(passesRedo({ outcome: 'solved_help', deepestRung: 3 })).toBe(false)
    expect(passesRedo({ outcome: 'gave_up', deepestRung: 1 })).toBe(false)
  })
})

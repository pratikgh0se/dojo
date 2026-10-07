import { describe, expect, it } from 'vitest'
import { attributeSession, currentSprint, planPosition, sprintOf, sprintRangeLabel, sprintStart } from '../../src/rules/sprint'

const START = '2026-09-07'
const ist = (s: string) => new Date(`${s}+05:30`).getTime()

describe('planPosition (Review Focus #4)', () => {
  it('is "before" the start date', () => {
    expect(planPosition(ist('2026-09-06T23:59:00'), START)).toEqual({ phase: 'before', daysUntil: 1 })
    expect(planPosition(ist('2026-09-01T09:00:00'), START)).toEqual({ phase: 'before', daysUntil: 6 })
  })
  it('starts sprint 1 day 1 at local midnight', () => {
    expect(planPosition(ist('2026-09-07T00:00:00'), START)).toEqual({ phase: 'active', sprint: 1, dayInSprint: 1, weekday: 'Mon' })
  })
  it('reports Friday as a normal active day (rest comes from rotation text)', () => {
    expect(planPosition(ist('2026-09-11T21:00:00'), START)).toEqual({ phase: 'active', sprint: 1, dayInSprint: 5, weekday: 'Fri' })
  })
  it('rolls to sprint 2 at local midnight after day 14', () => {
    expect(planPosition(ist('2026-09-20T23:59:00'), START)).toMatchObject({ sprint: 1, dayInSprint: 14 })
    expect(planPosition(ist('2026-09-21T00:00:00'), START)).toMatchObject({ sprint: 2, dayInSprint: 1 })
  })
  it('keeps sprint 72 through its last day and is "after" the next day', () => {
    expect(planPosition(ist('2029-06-10T12:00:00'), START)).toEqual({ phase: 'active', sprint: 72, dayInSprint: 14, weekday: 'Sun' })
    expect(planPosition(ist('2029-06-11T00:00:00'), START)).toEqual({ phase: 'after', daysSinceEnd: 0 })
  })
})

describe('sprint helpers', () => {
  it('clamps currentSprint to 1..72 but sprintOf does not', () => {
    expect(currentSprint(ist('2026-09-01T09:00:00'), START)).toBe(1)
    expect(currentSprint(ist('2030-01-01T09:00:00'), START)).toBe(72)
    expect(sprintOf(ist('2026-09-01T09:00:00'), START)).toBe(0)
  })
  it('gives each sprint a local-midnight start', () => {
    expect(sprintStart(2, START)).toBe(ist('2026-09-21T00:00:00'))
  })
  it('attributes a session that crosses midnight and a sprint boundary to its start (Review Focus #3)', () => {
    const start = ist('2026-09-20T23:40:00')
    expect(attributeSession(start, START)).toEqual({ dayKey: '2026-09-20', sprint: 1 })
    expect(attributeSession(Date.parse('2026-09-20T18:30:00Z'), START)).toEqual({ dayKey: '2026-09-21', sprint: 2 })
  })
})

describe('sprintRangeLabel', () => {
  it('shows a single sprint without a dash', () => {
    expect(sprintRangeLabel(1, 1)).toBe('S1')
    expect(sprintRangeLabel(7, 7)).toBe('S7')
  })
  it('shows a dashed range when the span covers more than one sprint', () => {
    expect(sprintRangeLabel(2, 4)).toBe('S2–S4')
    expect(sprintRangeLabel(31, 38)).toBe('S31–S38')
  })
})

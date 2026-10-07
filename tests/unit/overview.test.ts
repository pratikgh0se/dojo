import { describe, expect, it } from 'vitest'
import { COVERAGE, OUT_OF_SCOPE, rulesOfTheRoad, UNDERSTANDING } from '../../src/content/overview'
import { SAMPLE_SCHEDULE } from '../../src/content/schedule'
import { localDayKey } from '../../src/lib/dates'
import { CHECKPOINT_SPRINT, timelineBands, timelineTicks, type Band } from '../../src/rules/overview'
import { effectiveLastSprint, sprintStart } from '../../src/rules/sprint'
import { realPlan, smallPlan } from '../helpers/plan'
import { mkTicket } from '../helpers/tickets'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const START = '2026-10-05'

const coversContiguously = (bands: Band[], from: number, to: number) => {
  expect(bands[0].from).toBe(from)
  expect(bands[bands.length - 1].to).toBe(to)
  bands.slice(1).forEach((b, i) => expect(b.from).toBe(bands[i].to + 1))
}

describe('timelineBands', () => {
  it('phases and stages each cover S1–S72 on the live plan; design window S21–S56; checkpoint S38', () => {
    const tl = timelineBands(realPlan(), START, ist('2026-10-20T10:00:00'))
    expect(tl.phases).toHaveLength(8)
    coversContiguously(tl.phases, 1, 72)
    expect(tl.stages).toHaveLength(12)
    coversContiguously(tl.stages, 1, 72)
    expect(tl.stages[7]).toEqual({ label: 'Stage 07 · AI infra on Kubernetes', from: 31, to: 38 })
    expect(tl.designs).toEqual({ label: 'Design bank', from: 21, to: 56 })
    expect(tl.checkpoint).toBe(CHECKPOINT_SPRINT)
    expect(tl.total).toBe(72)
    expect(tl.now).toBe(2)
  })
  it('has no NOW before start, after the window, or without a start date (Review Focus #5)', () => {
    const plan = realPlan()
    expect(timelineBands(plan, START, ist('2026-10-01T10:00:00')).now).toBeNull()
    expect(timelineBands(plan, START, ist('2030-01-01T10:00:00')).now).toBeNull()
    expect(timelineBands(plan, '', ist('2026-10-20T10:00:00')).now).toBeNull()
  })
  it('a live ticket slid past S72 keeps NOW live in S73 (Review Focus: consistent current sprint)', () => {
    const tickets = [mkTicket({ id: 'slid', sprint: 74, status: 'todo' })]
    const lastSprint = effectiveLastSprint(tickets)
    expect(lastSprint).toBe(74)
    const s73Date = localDayKey(sprintStart(73, START))
    const tl = timelineBands(realPlan(), START, ist(`${s73Date}T10:00:00`), lastSprint)
    expect(tl.now).toBe(73)
    expect(tl.total).toBeGreaterThanOrEqual(74)
  })
  it('renders empty bands for a plan without phases or stages', () => {
    const tl = timelineBands(smallPlan, START, ist('2026-10-20T10:00:00'))
    expect(tl.phases).toEqual([])
    expect(tl.stages).toEqual([])
    expect(tl.designs).toEqual({ label: 'Design bank', from: 2, to: 3 })
    expect(timelineBands({ ...smallPlan, design_bank: [] }, START, 0).designs).toBeNull()
  })
})

describe('timelineTicks', () => {
  it('labels every block start with its date', () => {
    const ticks = timelineTicks(START)
    expect(ticks).toHaveLength(18)
    expect(ticks[0]).toEqual({ sprint: 1, label: 'S1 · 2026-10-05' })
    expect(ticks[1]).toEqual({ sprint: 5, label: 'S5 · 2026-11-30' })
  })
  it('falls back to sprint numbers without a start date', () => {
    expect(timelineTicks('')[0]).toEqual({ sprint: 1, label: 'S1' })
  })
})

describe('overview content', () => {
  it('drops forge-contradicting sentences and the applied-AI row', () => {
    const RULES_OF_THE_ROAD = rulesOfTheRoad(SAMPLE_SCHEDULE)
    const rules = RULES_OF_THE_ROAD.items.map(i => `${i.lead ?? ''} ${i.text}`).join(' ')
    expect(rules).toContain('Compressing it means skipping sleep, exercise, or family,')
    expect(rulesOfTheRoad({ protects: 'my evenings' }).items.map(i => i.text).join(' ')).toContain('skipping my evenings,')
    expect(rules).not.toContain('Wednesday AI build')
    expect(rules).not.toContain('When a video shows code')
    expect(rules).toContain('Friday is off.')
    expect(RULES_OF_THE_ROAD.items).toHaveLength(7)
    expect(COVERAGE.rows.some(r => r[0].startsWith('Applied AI engineering'))).toBe(false)
    expect(COVERAGE.rows).toHaveLength(10)
    expect(UNDERSTANDING.items).toHaveLength(8)
    expect(OUT_OF_SCOPE.items.map(i => i.text)).toContain('CUDA below Triton')
  })
})

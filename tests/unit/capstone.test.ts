import { describe, expect, it } from 'vitest'
import type { PlanJson, Ticket } from '../../src/data/types'
import {
  checkpointAfterStage, defaultStage, sessionBalance, shelfBySkill, stageBadges, stageBands, stageLabel, stageProgress, STAGE_COUNT,
} from '../../src/rules/capstone'
import { CHECKPOINT_SPRINT } from '../../src/rules/overview'
import { newTicket, planToTickets } from '../../src/rules/planTickets'
import { realPlan, smallPlan } from '../helpers/plan'
import { stagePlan } from '../helpers/stagePlan'

const ticketsOf = (plan: PlanJson) => planToTickets(plan).map(newTicket)
const mark = (ts: Ticket[], ids: string[], patch: Partial<Ticket>) => ts.map(t => (ids.includes(t.id) ? { ...t, ...patch } : t))

describe('stageBands (Review Focus #3)', () => {
  it('derives bands from sprints[].ai[].stage and focus_ai, not from constants', () => {
    expect(stageBands(stagePlan())).toEqual([
      { stage: 5, title: 'Alpha', from: 1, to: 2 },
      { stage: 6, title: 'Beta', from: 3, to: 3 },
    ])
  })
  it('yields the live plan’s 12 stages covering S1–S72, Stage 07 = S31–S38', () => {
    const bands = stageBands(realPlan())
    expect(bands.map(b => b.stage)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(bands[1]).toEqual({ stage: 1, title: 'micrograd', from: 2, to: 4 })
    expect(bands[7]).toEqual({ stage: 7, title: 'AI infra on Kubernetes', from: 31, to: 38 })
    expect(bands[0].from).toBe(1)
    expect(bands[11].to).toBe(72)
    bands.slice(1).forEach((b, i) => expect(b.from).toBe(bands[i].to + 1))
  })
  it('is empty for a plan without stage tickets', () => {
    expect(stageBands(smallPlan)).toEqual([])
  })
  it('labels stages with two digits', () => {
    expect(stageLabel(7)).toBe('Stage 07')
    expect(stageLabel(11)).toBe('Stage 11')
  })
})

describe('checkpointAfterStage', () => {
  it('places the S38 checkpoint after Stage 07 on the live plan', () => {
    expect(CHECKPOINT_SPRINT).toBe(38)
    expect(checkpointAfterStage(stageBands(realPlan()), CHECKPOINT_SPRINT)).toBe(7)
  })
  it('follows the data: the last band ending at or before the checkpoint', () => {
    const bands = stageBands(stagePlan())
    expect(checkpointAfterStage(bands, 2)).toBe(5)
    expect(checkpointAfterStage(bands, 3)).toBe(6)
    expect(checkpointAfterStage(bands, 1)).toBeNull()
  })
})

describe('stageProgress', () => {
  const plan = stagePlan()
  const [alpha, beta] = stageBands(plan)

  it('has one row per sprint with the four stage tickets of that sprint', () => {
    const p = stageProgress(alpha, ticketsOf(plan), 1)
    expect(p.rows.map(r => r.sprint)).toEqual([1, 2])
    expect(p.rows[0].cells.watch?.id).toBe('st5-s1-watch')
    expect(p.rows[1].cells.teachback?.id).toBe('st5-s2-teachback')
    expect(p).toMatchObject({ done: 0, total: 8 })
  })
  it('states: upcoming before start or before the band, current inside, behind after, done when all done (Review Focus #5)', () => {
    const ts = ticketsOf(plan)
    expect(stageProgress(alpha, ts, 0).state).toBe('upcoming')
    expect(stageProgress(beta, ts, 2).state).toBe('upcoming')
    expect(stageProgress(alpha, ts, 2).state).toBe('current')
    expect(stageProgress(alpha, ts, 3).state).toBe('behind')
    expect(stageProgress(alpha, ts, 73).state).toBe('behind')
    const allAlpha = ts.filter(t => t.stage === 5).map(t => t.id)
    expect(stageProgress(alpha, mark(ts, allAlpha, { status: 'done' }), 0).state).toBe('done')
  })
  it('excludes archived tickets from counts and cells', () => {
    const p = stageProgress(alpha, mark(ticketsOf(plan), ['st5-s1-watch'], { archived: true }), 1)
    expect(p.total).toBe(7)
    expect(p.rows[0].cells.watch).toBeNull()
  })
  it('keeps a slid ticket in its planned row, showing its own status', () => {
    const ts = mark(ticketsOf(plan), ['st5-s1-build'], { sprint: 3, slidFrom: [1] })
    const p = stageProgress(alpha, ts, 2)
    expect(p.rows[0].cells.build).toMatchObject({ id: 'st5-s1-build', sprint: 3 })
  })
})

describe('defaultStage', () => {
  it('picks the current band, else the first unfinished one', () => {
    const plan = stagePlan()
    const bands = stageBands(plan)
    const ts = ticketsOf(plan)
    const at = (cur: number, tickets: Ticket[] = ts) => defaultStage(bands, new Map(bands.map(b => [b.stage, stageProgress(b, tickets, cur)])))?.stage
    expect(at(3)).toBe(6)
    expect(at(0)).toBe(5)
    const allAlpha = ts.filter(t => t.stage === 5).map(t => t.id)
    expect(at(73, mark(ts, allAlpha, { status: 'done' }))).toBe(6)
    expect(defaultStage([], new Map())).toBeNull()
  })
})

describe('sessionBalance', () => {
  it('counts done vs total per session across the plan; 72 of each on the live plan', () => {
    const plan = realPlan()
    const ts = ticketsOf(plan)
    expect(sessionBalance(ts)).toEqual({
      watch: { done: 0, total: 72 }, rebuild: { done: 0, total: 72 }, build: { done: 0, total: 72 }, teachback: { done: 0, total: 72 },
    })
    const watched = ts.filter(t => t.session === 'watch').slice(0, 2).map(t => t.id)
    const b = sessionBalance(mark(ts, watched, { status: 'done' }))
    expect(b.watch).toEqual({ done: 2, total: 72 })
    expect(b.rebuild).toEqual({ done: 0, total: 72 })
  })
})

describe('stageBadges', () => {
  it('has 12 badges (Stage 00–11), uncleared when a plan has no stage tickets', () => {
    expect(STAGE_COUNT).toBe(12)
    const badges = stageBadges([])
    expect(badges).toHaveLength(12)
    expect(badges.map(b => b.stage)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(badges.every(b => b.cleared === false)).toBe(true)
  })
  it('clears a badge only once every non-archived ticket of that stage is done', () => {
    const plan = stagePlan()
    const ts = ticketsOf(plan)
    expect(stageBadges(ts).filter(b => b.cleared)).toEqual([])
    const allStage5 = ts.filter(t => t.stage === 5).map(t => t.id)
    const done = stageBadges(mark(ts, allStage5, { status: 'done' }))
    expect(done.find(b => b.stage === 5)).toEqual({ stage: 5, cleared: true })
    expect(done.find(b => b.stage === 6)).toEqual({ stage: 6, cleared: false })
  })
  it('ignores archived tickets: a stage with only archived tickets stays uncleared', () => {
    const plan = stagePlan()
    const ts = ticketsOf(plan)
    const allStage5 = ts.filter(t => t.stage === 5).map(t => t.id)
    const archived = stageBadges(mark(ts, allStage5, { archived: true }))
    expect(archived.find(b => b.stage === 5)).toEqual({ stage: 5, cleared: false })
  })
  it('covers all 12 stages on the live plan, none cleared yet', () => {
    const badges = stageBadges(ticketsOf(realPlan()))
    expect(badges).toHaveLength(12)
    expect(badges.every(b => b.cleared === false)).toBe(true)
  })
})

describe('shelfBySkill', () => {
  it('groups the shelf by skill in first-appearance order with skill labels', () => {
    expect(shelfBySkill(stagePlan()).map(g => [g.skill, g.label, g.items.length])).toEqual([
      ['nn', 'Neural nets', 1],
      ['papers', 'papers', 1],
    ])
  })
  it('covers the live shelf (132 items)', () => {
    const groups = shelfBySkill(realPlan())
    expect(groups[0]).toMatchObject({ skill: 'aieng', label: 'AI engineering (RAG, agents, evals)' })
    expect(groups.reduce((a, g) => a + g.items.length, 0)).toBe(132)
  })
  it('is empty without a shelf', () => {
    expect(shelfBySkill(smallPlan)).toEqual([])
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { InterviewFinal } from '../../src/ai/types'
import type { CloseAnswers, DeepDive } from '../../src/data/types'
import {
  capScore, cappedDive, clockText, closeComplete, divesText, EMPTY_CLOSE, interviewStage, interviewStoppedText, isOverdue,
  lensText, lockAt, lockReason, lockStatusText, needsInterviewerTurn, needsRedesign, parseRubric, pngName, prefillFromFinal,
  redesignDueAt, remainingMs, RUBRIC_BREAKDOWN, scoreReady, seedTradeoffs, SESSION_MS, summaryText,
} from '../../src/rules/designSession'
import { findDesign, planDesigns, tierShort } from '../../src/rules/designs'
import { realPlan } from '../helpers/plan'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-11T10:00:00')
const MIN = 60_000
const dives = (...a: (0 | 1 | 2 | null)[]): DeepDive[] => a.map((answered, i) => ({ q: `dive ${i + 1}`, answered }))
const msgs = (answers: number) => {
  const out: { from: 'interviewer' | 'you'; text: string }[] = [{ from: 'interviewer', text: 'q0' }]
  for (let i = 1; i <= answers; i++) out.push({ from: 'you', text: `a${i}` }, { from: 'interviewer', text: `q${i}` })
  return out
}
const FULL_CLOSE: CloseAnswers = {
  tradeoff: { chose: 'sliding window counter in Redis', over: 'token bucket per node', because: 'global limit needs shared state; 2 ms Redis RTT is fine' },
  breaksAt10x: 'Redis', dataOwnership: 'Redis owns counters', couldNotAnswer: 1, readNext: 'Stripe rate limiter blog post',
}

describe('clock (D-5, D-6, D-8, D-9)', () => {
  it('counts down from 45:00 with ceil seconds', () => {
    expect(clockText(remainingMs({ at: T }, T))).toBe('45:00')
    expect(clockText(remainingMs({ at: T }, T + 10 * MIN))).toBe('35:00')
    expect(clockText(remainingMs({ at: T }, T + 10 * MIN + 400))).toBe('35:00')
    expect(clockText(remainingMs({ at: T }, T + 44 * MIN + 59_000))).toBe('00:01')
    expect(clockText(remainingMs({ at: T }, T + 45 * MIN))).toBe('00:00')
    expect(clockText(remainingMs({ at: T }, T + 3 * 60 * MIN))).toBe('00:00')
  })

  it('freezes at the lock', () => {
    expect(clockText(remainingMs({ at: T, lockedAt: T + 12 * MIN }, T + 30 * MIN))).toBe('33:00')
  })

  it('is overdue only while drawing and from 45:00', () => {
    expect(isOverdue({ at: T, phase: 'drawing' }, T + SESSION_MS - 1)).toBe(false)
    expect(isOverdue({ at: T, phase: 'drawing' }, T + SESSION_MS)).toBe(true)
    expect(isOverdue({ at: T, phase: 'close' }, T + SESSION_MS)).toBe(false)
  })

  it('locks early with floored minutes and late at exactly 45 (Review Focus #1)', () => {
    expect(lockAt({ at: T }, T + 12 * MIN + 300)).toEqual({ lockedAt: T + 12 * MIN + 300, minutes: 12 })
    expect(lockAt({ at: T }, T + 5 * 60 * MIN)).toEqual({ lockedAt: T + SESSION_MS, minutes: 45 })
  })

  it('derives the lock reason and texts', () => {
    expect(lockReason({ at: T })).toBeNull()
    expect(lockReason({ at: T, lockedAt: T + 12 * MIN })).toBe('ended')
    expect(lockReason({ at: T, lockedAt: T + SESSION_MS })).toBe('timer')
    expect(lockStatusText('timer')).toBe('Canvas locked at 45 minutes')
    expect(lockStatusText('ended')).toBe('Canvas locked')
    expect(interviewStoppedText('timer')).toBe('Interview stopped at 45 minutes')
    expect(interviewStoppedText('ended')).toBe('Interview stopped')
  })
})

describe('interview stage (D-32, D-33, DECISION 11)', () => {
  it('walks requirements, 4 × (ask, push-back), complete', () => {
    expect(interviewStage(msgs(0))).toMatchObject({ answers: 0, activeDive: 0, complete: false, status: 'Requirements' })
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(a => interviewStage(msgs(a)).activeDive)).toEqual([1, 1, 2, 2, 3, 3, 4, 4])
    expect(interviewStage(msgs(3)).status).toBe('Deep dive 2 of 4')
    expect(interviewStage(msgs(9))).toMatchObject({ answers: 9, complete: true, status: 'Interview complete · 4 of 4 deep dives' })
  })

  it('needs an interviewer turn when empty or after a learner message', () => {
    expect(needsInterviewerTurn([])).toBe(true)
    expect(needsInterviewerTurn(msgs(2))).toBe(false)
    expect(needsInterviewerTurn([...msgs(2), { from: 'you', text: 'a3' }])).toBe(true)
  })
})

describe('close and score (D-25…D-30)', () => {
  it('requires all five answers', () => {
    expect(closeComplete(EMPTY_CLOSE)).toBe(false)
    expect(closeComplete(FULL_CLOSE)).toBe(true)
    expect(closeComplete({ ...FULL_CLOSE, readNext: '  ' })).toBe(false)
    expect(closeComplete({ ...FULL_CLOSE, couldNotAnswer: null })).toBe(false)
    expect(closeComplete({ ...FULL_CLOSE, couldNotAnswer: 'none' })).toBe(true)
  })

  it('caps the Q4 dive', () => {
    expect(cappedDive(FULL_CLOSE)).toBe(1)
    expect(cappedDive({ ...FULL_CLOSE, couldNotAnswer: 'none' })).toBeNull()
    expect(capScore(2, 1, 1)).toBe(1)
    expect(capScore(2, 0, 1)).toBe(2)
    expect(capScore(1, 1, 1)).toBe(1)
  })

  it('seeds trade-off 1 from Q1 plus one blank row', () => {
    expect(seedTradeoffs(FULL_CLOSE, [])).toEqual([FULL_CLOSE.tradeoff, { chose: '', over: '', because: '' }])
    const kept = [{ chose: 'a', over: 'b', because: 'c' }]
    expect(seedTradeoffs(FULL_CLOSE, kept)).toBe(kept)
  })

  it('parses the rubric', () => {
    expect(parseRubric('')).toEqual({ value: null, invalid: false })
    expect(parseRubric('12')).toEqual({ value: 12, invalid: false })
    expect(parseRubric('0')).toEqual({ value: 0, invalid: false })
    expect(parseRubric('20')).toEqual({ value: 20, invalid: false })
    for (const bad of ['21', '-1', '12.5', 'abc', '1e1']) expect(parseRubric(bad)).toEqual({ value: null, invalid: true })
  })

  it('is ready only with 4 dives, 7 lenses, 2 complete trade-offs and a rubric', () => {
    const ok = {
      deepDives: dives(2, 1, 2, 0),
      lenses: { load: 2, data: 1, consistency: 1, failure: 0, latency: 2, cost: 1, evolution: 1 } as const,
      tradeoffs: [FULL_CLOSE.tradeoff, { chose: 'fail open', over: 'fail closed', because: 'limiter outage must not take the API down' }],
      rubric: 12,
    }
    expect(scoreReady(ok)).toBe(true)
    expect(scoreReady({ ...ok, deepDives: dives(2, 1, null, 0) })).toBe(false)
    expect(scoreReady({ ...ok, lenses: { ...ok.lenses, cost: undefined } })).toBe(false)
    expect(scoreReady({ ...ok, tradeoffs: [ok.tradeoffs[0], { chose: 'x', over: '', because: 'y' }] })).toBe(false)
    expect(scoreReady({ ...ok, rubric: null })).toBe(false)
    expect(scoreReady({ ...ok, rubric: 21 })).toBe(false)
  })

  it('prefills from the fake grade and lowers the capped dive (D-37)', () => {
    const final = {
      done: true, score: 15, perItem: [], oneThingToStudy: '[fake:interview] d-ratelimit',
      deepDives: [2, 1, 2, 1], lenses: { load: 2, data: 1, consistency: 1, failure: 1, latency: 1, cost: 0, evolution: 1 },
    } as unknown as InterviewFinal
    const p = prefillFromFinal(final, dives(null, null, null, null), 0)
    expect(p.deepDives.map(d => d.answered)).toEqual([1, 1, 2, 1])
    expect(p.deepDives.every(d => d.by === 'model')).toBe(true)
    expect(p.lenses).toEqual({ load: 2, data: 1, consistency: 1, failure: 1, latency: 1, cost: 0, evolution: 1 })
    expect(p.rubric).toBe(15)
  })

  it('has the rubric breakdown text', () => {
    expect(RUBRIC_BREAKDOWN).toBe('Requirements and numbers (4) · API and data model (3) · High-level design that meets the numbers (4) · Two deep dives with real trade-offs (6) · Failure modes and operations (3)')
  })
})

describe('redesign rule (D-45)', () => {
  it('queues when rubric < 14 or any dive is 0', () => {
    expect(needsRedesign(12, dives(2, 1, 2, 0))).toBe(true)
    expect(needsRedesign(15, dives(1, 1, 2, 1))).toBe(false)
    expect(needsRedesign(14, dives(1, 1, 1, 1))).toBe(false)
    expect(needsRedesign(20, dives(2, 2, 0, 2))).toBe(true)
    expect(needsRedesign(13, dives(2, 2, 2, 2))).toBe(true)
  })

  it('is due at local midnight 30 days later', () => {
    expect(redesignDueAt(ist('2026-10-11T10:30:00'))).toBe(ist('2026-11-10T00:00:00'))
  })
})

describe('texts', () => {
  it('summarises a session (D-31, D-37)', () => {
    expect(summaryText({ mode: 'solo', minutes: 12, rubric: 12 })).toBe('Solo · 12 min · rubric 12 / 20')
    expect(summaryText({ mode: 'interviewer', minutes: 45, rubric: 15 })).toBe('Interviewer · 45 min · rubric 15 / 20')
    expect(divesText(dives(2, 1, 2, 0))).toBe('2 · 1 · 2 · 0')
    expect(lensText({ load: 2, data: 1, consistency: 1, failure: 0, latency: 2, cost: 1, evolution: 1 }))
      .toBe('Load 2 · Data 1 · Consistency 1 · Failure 0 · Latency 2 · Cost 1 · Evolution 1')
  })

  it('names PNGs by design and session day (D-43, D-44)', () => {
    expect(pngName('d-ratelimit', T)).toBe('d-ratelimit-2026-10-11.png')
    expect(pngName('d-ratelimit', T, 'reference')).toBe('d-ratelimit-2026-10-11-reference.png')
  })
})

describe('plan design references', () => {
  it('lists the 48 designs in plan order with d-ratelimit 7th in tier 2', () => {
    const all = planDesigns(realPlan())
    expect(all).toHaveLength(48)
    expect(all[6]).toMatchObject({ id: 'd-ratelimit', title: 'Distributed rate limiter and API gateway', tier: 2, order: 6, difficulty: 'M' })
    expect(all[6].tierName).toBe('Core distributed systems (sprints 25 to 32)')
    expect(all[6].tierLabel).toBe('Core distributed systems')
    expect(all[6].deepDives[1]).toBe('Where state lives: local, Redis, or gossip; what happens on partition')
    expect(all[7].id).toBe('d-cache')
    expect(findDesign(realPlan(), 'd-nope')).toBeNull()
  })

  it('shortens tier names like the prototype chart', () => {
    expect(realPlan().design_bank.map(t => tierShort(t.tier))).toEqual(['Foundations', 'Distributed', 'Classic', 'Data-heavy', 'ML platforms', 'LLM + agents'])
  })
})

describe('.ds-well sr-diagram CSS (Review Focus: dead rule without !important)', () => {
  it('forces display:block with !important, since <sr-diagram> sets an inline display style that would otherwise win', () => {
    const css = readFileSync('src/screens/designSession/session.css', 'utf8')
    const rule = css.match(/\.ds-well sr-diagram\s*\{[^}]*\}/)?.[0]
    expect(rule).toBeDefined()
    expect(rule).toMatch(/display:\s*block\s*!important/)
  })
})

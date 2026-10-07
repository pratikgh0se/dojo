import { describe, expect, it } from 'vitest'
import type { Lens, Score012 } from '../../src/ai/types'
import type { DesignSession } from '../../src/data/types'
import {
  doneSessions, lensSeries, lensStats, outstandingFor, passRateText, radarData, radarJson, radarLabel, redesignPassRate,
  redesignQueue, shelfTiers, sparkLabel, vocabCount, vocabText, wallAnswered, wallRows,
} from '../../src/rules/designEvidence'
import { planDesigns } from '../../src/rules/designs'
import { realPlan } from '../helpers/plan'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const DESIGNS = planDesigns(realPlan())
type L = Record<Lens, Score012>
const S1_LENSES: L = { load: 2, data: 1, consistency: 1, failure: 0, latency: 2, cost: 1, evolution: 1 }
const S2_LENSES: L = { load: 2, data: 1, consistency: 1, failure: 1, latency: 1, cost: 0, evolution: 1 }
const node = (kind: string, n = 1) => ({ id: `${kind}-${n}`, kind, label: `${kind} ${n}`, x: 0, y: 0 })

let seq = 0
function mk(designId: string, p: Partial<DesignSession> & { dives?: (0 | 1 | 2)[]; kinds?: string[] } = {}): DesignSession {
  const at = p.at ?? ist('2026-10-11T10:00:00')
  return {
    id: p.id ?? `s${++seq}`, designId, at, phase: p.phase ?? 'done', endedAt: p.endedAt ?? at + 50 * 60_000, lockedAt: at + 12 * 60_000,
    minutes: 12, mode: 'solo', view: '2d',
    canvas: { layout: 'manual', nodes: (p.kinds ?? ['gateway', 'service', 'cache', 'sql']).map(k => node(k)), links: [], zones: [], flows: [] },
    close: { tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 1, readNext: p.close?.readNext ?? 'Stripe rate limiter blog post' },
    deepDives: (p.dives ?? [2, 1, 2, 0]).map((answered, i) => ({ q: `q${i}`, answered })),
    tradeoffs: [], rubric: p.rubric ?? 12, lenses: p.lenses ?? S1_LENSES,
    ...(p.redesignDue !== undefined ? { redesignDue: p.redesignDue } : {}),
    ...(p.redesignOf ? { redesignOf: p.redesignOf } : {}),
  } as DesignSession
}
const S1 = () => mk('d-ratelimit', { id: 'S1', redesignDue: ist('2026-11-10T00:00:00') })
const S2 = () => mk('d-cache', { id: 'S2', at: ist('2026-10-18T10:00:00'), dives: [1, 1, 2, 1], lenses: S2_LENSES, rubric: 15 })

describe('lens statistics (D-49, D-51)', () => {
  it('uses only completed sessions in completion order', () => {
    const open = mk('d-kv', { phase: 'drawing' })
    expect(doneSessions([S2(), open, S1()]).map(s => s.id)).toEqual(['S1', 'S2'])
  })

  it('equals S1 alone, then averages S1 and S2', () => {
    const one = lensStats(doneSessions([S1()]))
    expect(radarJson(one.last6, 1)).toEqual(S1_LENSES)
    expect(radarJson(one.mean, 1)).toEqual(S1_LENSES)
    const two = lensStats(doneSessions([S1(), S2()]))
    const expected = { load: 2, data: 1, consistency: 1, failure: 0.5, latency: 1.5, cost: 0.5, evolution: 1 }
    expect(radarJson(two.last6, 2)).toEqual(expected)
    expect(radarJson(two.mean, 2)).toEqual(expected)
  })

  it('keeps the last 6 apart from the all-time mean', () => {
    const seven = [mk('d-kv', { lenses: { ...S1_LENSES, load: 0 }, endedAt: 1 }), ...Array.from({ length: 6 }, (_, i) => mk('d-kv', { endedAt: 10 + i }))]
    const st = lensStats(doneSessions(seven))
    expect(st.last6.load).toBe(2)
    expect(st.mean.load).toBe(1.71)
  })

  it('names the radar exactly', () => {
    expect(radarLabel(lensStats([]), 0)).toBe('Lens radar · No sessions yet')
    const vals = 'Load 2.0, Data 1.0, Consistency 1.0, Failure 0.0, Latency 2.0, Cost 1.0, Evolution 1.0'
    expect(radarLabel(lensStats(doneSessions([S1()])), 1)).toBe(`Lens radar · last 6: ${vals} · all-time: ${vals}`)
    expect(radarJson(lensStats([]).last6, 0)).toEqual({})
  })

  it('feeds charts.js radial with [mean, last 6] scaled ×50', () => {
    expect(radarData(lensStats([]), 0)).toEqual({ axes: ['Load', 'Data', 'Consistency', 'Failure', 'Latency', 'Cost', 'Evolution'], series: [] })
    expect(radarData(lensStats(doneSessions([S1()])), 1).series).toEqual([[100, 50, 50, 0, 100, 50, 50], [100, 50, 50, 0, 100, 50, 50]])
  })

  it('builds sparkline series and names', () => {
    const series = lensSeries(doneSessions([S1(), S2()]))
    expect(series.failure).toEqual([0, 1])
    expect(sparkLabel('failure', series.failure)).toBe('Failure trend: 0, 1')
    expect(sparkLabel('cost', [])).toBe('Cost trend: No sessions yet')
  })
})

describe('deep-dive wall (D-50)', () => {
  it('is 4 rows × 48 columns in plan order, all none when empty', () => {
    const rows = wallRows(DESIGNS, [])
    expect(rows).toHaveLength(4)
    expect(rows.every(r => r.length === 48)).toBe(true)
    expect(rows[0][6].designId).toBe('d-ratelimit')
    expect(rows.flat().every(c => c.state === 'none' && c.sessionId === null)).toBe(true)
    expect(wallAnswered(rows)).toBe(0)
  })

  it('shows S1 and keeps the best ever', () => {
    const later = mk('d-ratelimit', { id: 'later', dives: [0, 2, 1, 0], endedAt: ist('2026-10-20T10:00:00') })
    const rows = wallRows(DESIGNS, doneSessions([S1(), later]))
    expect(rows.map(r => r[6].state)).toEqual(['ok', 'ok', 'ok', 'none'])
    expect(rows[0][6].name).toBe('Distributed rate limiter and API gateway · deep dive 1 · answered')
    expect(rows[3][6].name).toBe('Distributed rate limiter and API gateway · deep dive 4 · not answered')
    expect(rows[0][6].sessionId).toBe('later')
    const s1Only = wallRows(DESIGNS, doneSessions([S1()]))
    expect(s1Only.map(r => r[6].state)).toEqual(['ok', 'glow', 'ok', 'none'])
    expect(s1Only[1][6].name).toBe('Distributed rate limiter and API gateway · deep dive 2 · hand-wave')
    expect(wallAnswered(s1Only)).toBe(2)
  })
})

describe('shelf and vocabulary (D-52, D-53)', () => {
  it('groups thumbnails by tier', () => {
    expect(shelfTiers(DESIGNS, [])).toEqual([])
    const tiers = shelfTiers(DESIGNS, doneSessions([S1()]))
    expect(tiers).toHaveLength(1)
    expect(tiers[0]).toMatchObject({ tier: 2, label: 'Core distributed systems' })
    expect(tiers[0].thumbs.map(t => t.name)).toEqual(['Distributed rate limiter and API gateway · 2026-10-11 · 4 nodes'])
    expect(tiers[0].thumbs[0]).toMatchObject({ sessionId: 'S1', designId: 'd-ratelimit', nodes: 4 })
  })

  it('counts distinct kinds', () => {
    expect(vocabText(vocabCount([]))).toBe('Vocabulary · 0 of 38 kinds used')
    expect(vocabCount(doneSessions([S1()]))).toBe(4)
    expect(vocabCount(doneSessions([S1(), mk('d-kv', { kinds: ['gateway', 'queue', 'teapot'] })]))).toBe(5)
  })
})

describe('redesigns (D-45…D-47)', () => {
  it('queues S1, due from its day, with the Q5 ticket line', () => {
    const before = redesignQueue(DESIGNS, [S1()], ist('2026-11-09T23:00:00'))
    expect(before).toEqual([{
      designId: 'd-ratelimit', title: 'Distributed rate limiter and API gateway', sessionId: 'S1', due: ist('2026-11-10T00:00:00'),
      dueText: '2026-11-10', state: 'queued', readNext: 'Stripe rate limiter blog post', previousRubric: 12,
    }])
    expect(redesignQueue(DESIGNS, [S1()], ist('2026-11-10T09:00:00'))[0].state).toBe('due')
    expect(outstandingFor([S1()], 'd-ratelimit')?.id).toBe('S1')
    expect(outstandingFor([S1()], 'd-cache')).toBeNull()
  })

  it('a passing redesign clears the queue and counts 1 / 1', () => {
    const pass = mk('d-ratelimit', { id: 'R1', redesignOf: 'S1', rubric: 16, dives: [2, 2, 1, 1], endedAt: ist('2026-11-10T11:00:00') })
    expect(redesignQueue(DESIGNS, [S1(), pass], ist('2026-11-10T12:00:00'))).toEqual([])
    expect(passRateText(redesignPassRate([S1(), pass]))).toBe('Redesign pass rate · 1 / 1')
  })

  it('a redesign at or below the previous rubric fails and may queue again', () => {
    const fail = mk('d-ratelimit', { id: 'R2', redesignOf: 'S1', rubric: 12, redesignDue: ist('2026-12-10T00:00:00'), endedAt: ist('2026-11-10T11:00:00') })
    expect(redesignPassRate([S1(), fail])).toEqual({ passed: 0, total: 1 })
    expect(redesignQueue(DESIGNS, [S1(), fail], ist('2026-11-11T00:00:00')).map(r => [r.sessionId, r.state])).toEqual([['R2', 'queued']])
    expect(passRateText({ passed: 0, total: 0 })).toBe('Redesign pass rate · 0 / 0')
  })

  it('ignores open sessions', () => {
    expect(redesignQueue(DESIGNS, [mk('d-kv', { phase: 'score', redesignDue: 1 })], 2)).toEqual([])
  })
})

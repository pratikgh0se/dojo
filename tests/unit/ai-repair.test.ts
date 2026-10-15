import { describe, expect, it } from 'vitest'
import { fakeOutput } from '../../src/ai/fake'
import { repairOutput } from '../../src/ai/repair'
import { validateOutput } from '../../src/ai/validate'

const turn = { context: { turn: 9, final: false } }
const final = { context: { turn: 9, final: true } }
const good = fakeOutput('interview', { ticket: { id: 'd-x', title: 'x', track: 'design', difficulty: 'M', links: [] }, context: { turn: 0, answers: [], deepDives: [], final: true } } as never)

describe('repairOutput (UAT cu-7 P2-1)', () => {
  it('an interview turn that says done:true, drops done, or names the line differently still becomes {say, done:false}', () => {
    for (const bad of [{ say: 'Thanks.', done: true }, { say: 'Thanks.' }, { reply: 'Thanks.', done: true }, { message: 'Thanks.' }]) {
      const fixed = repairOutput('interview', turn, bad)
      expect(fixed).toEqual({ say: 'Thanks.', done: false })
      expect(validateOutput('interview', fixed)).toEqual([])
    }
  })

  it('leaves a valid turn alone (same object) and cuts one that is over the word limit', () => {
    const ok = { say: 'One question?', done: false }
    expect(repairOutput('interview', turn, ok)).toBe(ok)
    const long = repairOutput('interview', turn, { say: Array.from({ length: 120 }, (_, i) => `w${i}`).join(' '), done: false }) as { say: string }
    expect(validateOutput('interview', long)).toEqual([])
    expect(long.say.split(' ').length).toBeLessThanOrEqual(80)
  })

  it('a turn with nothing to say stays invalid, so the helper asks again', () => {
    for (const bad of [{ done: true }, {}, { say: '  ' }]) {
      expect(validateOutput('interview', repairOutput('interview', turn, bad))).not.toEqual([])
    }
  })

  it('a final grade has its numbers coerced and clamped, and a missing score summed from the items', () => {
    const g = good as unknown as Record<string, unknown>
    const sloppy = { ...g, score: '15', deepDives: [2, '1', 3, -1], lenses: { ...(g.lenses as object), load: '2', cost: 5 } }
    const fixed = repairOutput('interview', final, sloppy) as Record<string, unknown>
    expect(fixed.score).toBe(15)
    expect(fixed.deepDives).toEqual([2, 1, 2, 0])
    expect(validateOutput('interview', fixed)).toEqual([])
    const noScore = { ...g }
    delete noScore.score
    expect(validateOutput('interview', repairOutput('interview', final, noScore))).toEqual([])
    expect(validateOutput('interview', repairOutput('interview', final, { ...g, score: 99 }))).toEqual([])
  })

  it('a final grade with nothing to build it from stays invalid', () => {
    expect(validateOutput('interview', repairOutput('interview', final, { done: true }))).not.toEqual([])
    expect(validateOutput('interview', repairOutput('interview', final, { done: true, score: 'high', perItem: 'none' }))).not.toEqual([])
  })

  it('other jobs pass through untouched', () => {
    const v = { hint: 'x' }
    expect(repairOutput('hint', {}, v)).toBe(v)
    expect(repairOutput('interview', turn, 'text')).toBe('text')
  })

  it('a session final: lists trimmed to their caps, non-strings dropped, score set to the sum of the five items', () => {
    const req = { context: { sessionGrade: true } }
    const fixed = repairOutput('grade', req, {
      done: true, score: 3, perItem: [{ item: 'a', points: 4, note: '' }, { item: 'b', points: 3, note: '' }, { item: 'c', points: 4, note: '' }, { item: 'd', points: 4, note: '' }, { item: 'e', points: 2, note: '' }],
      oneThingToStudy: 'x', deepDives: [1, 1, 1, 1], lenses: { load: 1, data: 1, consistency: 1, failure: 1, latency: 1, cost: 1, evolution: 1 },
      inconsistencies: ['1', '2', '3', '4', '5', '6', 7], stronger: ['a', 'b', 'c', 'd', 'e'],
    }) as Record<string, unknown>
    expect(fixed.score).toBe(17)
    expect(fixed.inconsistencies).toEqual(['1', '2', '3', '4', '5'])
    expect(fixed.stronger).toEqual(['a', 'b', 'c', 'd'])
    expect(validateOutput('grade', fixed)).toEqual([])
  })

  it('an artifact grade is never touched by the session repair', () => {
    const v = { score: 4, max: 5, passed: true, feedback: [], missing: [] }
    expect(repairOutput('grade', { context: {} }, v)).toBe(v)
  })
})

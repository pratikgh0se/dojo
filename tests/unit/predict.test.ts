import { beforeAll, describe, expect, it } from 'vitest'
import { WALKTHROUGHS } from '../../src/content/atlas'
import type { AlgoJson } from '../../src/rules/algoJson'
import { predictQuestions, predictResult } from '../../src/rules/predict'
import { resolveWalk, type AlgoGlobals } from '../../src/rules/walkthrough'
import { installAlgoEngines } from '../helpers/engines'

const g = () => window as unknown as AlgoGlobals
const walk = (key: string, input?: unknown): AlgoJson => {
  const r = resolveWalk(key, input, g())
  if (!r.ok) throw new Error(r.error)
  return r.json
}
const brief = (key: string, input?: unknown) => predictQuestions(walk(key, input)).map(q => [q.step, q.detail, q.choices.join(' | '), q.correct])

describe('predict mode (labs contract §4.4, D-8)', () => {
  beforeAll(installAlgoEngines)

  it('binary search [1,3,5,7,9] → 7 pauses on the four marks (S18)', () => {
    const marks = 'Mark done | Mark bad | Mark path'
    expect(brief('binarySearch', { a: [1, 3, 5, 7, 9], target: 7 })).toEqual([
      [5, 'What happens to this cell?', marks, 'Mark bad'],
      [6, 'What happens to this cell?', marks, 'Mark bad'],
      [7, 'What happens to this cell?', marks, 'Mark bad'],
      [12, 'What happens to this cell?', marks, 'Mark done'],
    ])
  })

  it('bubble sort [3,1,2] asks compares by the values on screen (S21)', () => {
    expect(brief('bubbleSort', [3, 1, 2]).map(q => [q[0], q[1], q[3]])).toEqual([
      [0, 'Compare a[0] = 3 with a[1] = 1', 'Left bigger'],
      [2, 'Compare a[1] = 3 with a[2] = 2', 'Left bigger'],
      [4, 'What happens to this cell?', 'Mark done'],
      [5, 'Compare a[0] = 1 with a[1] = 2', 'Right bigger'],
      [6, 'What happens to this cell?', 'Mark done'],
      [7, 'What happens to this cell?', 'Mark done'],
    ])
  })

  it('BFS asks for the next node among the frontier and unseen nodes (S22)', () => {
    const graph = { directed: false, nodes: { A: {}, B: {}, C: {}, D: {} }, edges: [['A', 'B'], ['A', 'C'], ['B', 'D']] }
    expect(brief('bfs', { graph, start: 'A' })).toEqual([
      [3, 'Which node is visited next?', 'A | B | C', 'A'],
      [15, 'Which node is visited next?', 'B | C | D', 'B'],
      [25, 'Which node is visited next?', 'C | D', 'C'],
    ])
  })

  it('coin change asks ∞ compares and written values, ∞ last (S23)', () => {
    expect(brief('coinChange', { coins: [1, 2, 5], amount: 11 }).slice(0, 2)).toEqual([
      [1, 'Compare a[0] = 0 with a[1] = ∞', 'Left bigger | Right bigger | Equal', 'Right bigger'],
      [2, 'What value is written?', '1 | 2 | ∞', '1'],
    ])
  })

  it('fills clashing value choices with v − 1, then v + 2', () => {
    const json: AlgoJson = { structures: { a: { type: 'array', values: [8, 0] } }, steps: [{ op: 'set', s: 'a', i: 0, v: 7 }, { op: 'set', s: 'a', i: 1, v: 0 }] }
    expect(predictQuestions(json).map(q => q.choices)).toEqual([['6', '7', '8'], ['-1', '0', '1']])
  })

  it('asks Kruskal about edges, so it is not a zero-question walkthrough (S24 note)', () => {
    const qs = predictQuestions(walk('kruskal'))
    expect(qs.length).toBeGreaterThan(0)
    expect(qs[0]).toMatchObject({ kind: 'edge', choices: ['Take edge', 'Reject edge', 'Leave edge'], correct: 'Take edge' })
  })

  it.each(WALKTHROUGHS.map(w => w.key))('%s: every question has 2–3 distinct choices including the right one', key => {
    for (const q of predictQuestions(walk(key))) {
      expect(q.choices.length).toBeGreaterThanOrEqual(2)
      expect(q.choices.length).toBeLessThanOrEqual(3)
      expect(new Set(q.choices).size).toBe(q.choices.length)
      expect(q.choices).toContain(q.correct)
      expect(q.choices.every(c => c.trim() !== '')).toBe(true)
    }
  })

  it('passes at 80% rounded down, never with zero questions (D-17)', () => {
    expect(predictResult(4, 4)).toEqual({ percent: 100, passed: true })
    expect(predictResult(3, 4)).toEqual({ percent: 75, passed: false })
    expect(predictResult(4, 5)).toEqual({ percent: 80, passed: true })
    expect(predictResult(5, 7)).toEqual({ percent: 71, passed: false })
    expect(predictResult(0, 0)).toEqual({ percent: 0, passed: false })
  })
})

import { beforeAll, describe, expect, it } from 'vitest'
import { predictQuestions } from '../../src/rules/predict'
import { initialPlayer, playLabel, playerReducer, predictScore, scrubStep, stepInterval, type PlayerAction, type PlayerState } from '../../src/rules/player'
import { resolveWalk, type AlgoGlobals } from '../../src/rules/walkthrough'
import { installAlgoEngines } from '../helpers/engines'

const qsOf = (key: string, input: unknown) => {
  const r = resolveWalk(key, input, window as unknown as AlgoGlobals)
  if (!r.ok) throw new Error(r.error)
  return { n: r.json.steps.length, qs: new Map(predictQuestions(r.json).map(q => [q.step, q])) }
}
const drive = (s: PlayerState, qs: Map<number, ReturnType<typeof predictQuestions>[number]>, ...as: PlayerAction[]) => as.reduce((x, a) => playerReducer(x, a, qs), s)
const F: PlayerAction = { type: 'forward' }

describe('player step machine (labs contract §4.2–4.4)', () => {
  beforeAll(installAlgoEngines)

  it('steps, clamps, and names the play button (S12)', () => {
    const qs = new Map()
    let s = initialPlayer(13)
    s = drive(s, qs, F, F)
    expect(s.k).toBe(2)
    s = drive(s, qs, { type: 'last' })
    expect([s.k, s.jumped, playLabel(s)]).toEqual([13, true, 'Replay'])
    s = drive(s, qs, F)
    expect(s.k).toBe(13)
    s = drive(s, qs, { type: 'first' }, { type: 'back' })
    expect(s.k).toBe(0)
    s = drive(s, qs, { type: 'play' })
    expect(playLabel(s)).toBe('Pause')
  })

  it('play stops at the end; Play at the end restarts from 0', () => {
    const qs = new Map()
    let s = drive(initialPlayer(2), qs, { type: 'play' }, F, F)
    expect([s.k, s.playing]).toEqual([2, false])
    s = drive(s, qs, { type: 'play' })
    expect([s.k, s.playing]).toEqual([0, true])
  })

  it('predict: play halts on arrival at a question, answers apply the step and do not resume (S18, D-19)', () => {
    const { n, qs } = qsOf('binarySearch', { a: [1, 3, 5, 7, 9], target: 7 })
    let s = drive(initialPlayer(n), qs, { type: 'predict', on: true }, { type: 'play' })
    for (let i = 0; i < 10 && s.playing; i++) s = drive(s, qs, F)
    expect([s.k, s.open, s.playing]).toEqual([5, 5, false])
    expect(drive(s, qs, F, { type: 'play' }, { type: 'last' })).toBe(s)
    s = drive(s, qs, { type: 'answer', choice: 'Mark bad' })
    expect([s.k, s.open, s.playing]).toEqual([6, null, false])
    expect(predictScore(s, qs)).toEqual({ correct: 1, answered: 1 })
    s = drive(s, qs, F)
    expect([s.k, s.open]).toEqual([6, 6])
    s = drive(s, qs, { type: 'answer', choice: 'Mark bad' }, F, { type: 'answer', choice: 'Mark bad' }, { type: 'play' })
    for (let i = 0; i < 10 && s.playing; i++) s = drive(s, qs, F)
    expect([s.k, s.open]).toEqual([12, 12])
    s = drive(s, qs, { type: 'answer', choice: 'Mark done' })
    expect([s.k, predictScore(s, qs)]).toEqual([13, { correct: 4, answered: 4 }])
  })

  it('predict: Step back closes the question unanswered; Step forward reopens it (S20)', () => {
    const { n, qs } = qsOf('binarySearch', { a: [1, 3, 5, 7, 9], target: 7 })
    let s = drive(initialPlayer(n), qs, { type: 'predict', on: true }, F, F, F, F, F)
    expect([s.k, s.open]).toEqual([5, 5])
    s = drive(s, qs, { type: 'back' })
    expect([s.k, s.open]).toEqual([4, null])
    s = drive(s, qs, F)
    expect([s.k, s.open]).toEqual([5, 5])
  })

  it('predict: a forward press at a question step opens it without moving (S21), answered steps replay silently', () => {
    const { n, qs } = qsOf('bubbleSort', [3, 1, 2])
    let s = drive(initialPlayer(n), qs, { type: 'predict', on: true }, F)
    expect([s.k, s.open]).toEqual([0, 0])
    s = drive(s, qs, { type: 'answer', choice: 'Left bigger' }, { type: 'back' }, F)
    expect([s.k, s.open]).toEqual([1, null])
  })

  it('entering predict resets k and the score; Last step is disabled in predict', () => {
    const qs = new Map()
    let s = drive(initialPlayer(5), qs, F, F, { type: 'predict', on: true })
    expect([s.k, s.answered]).toEqual([0, {}])
    s = drive(s, qs, { type: 'last' })
    expect(s.k).toBe(0)
  })

  it('advances every 600 ms at 1×, 900 ms under reduced motion, divided by the speed', () => {
    expect(stepInterval(1, false)).toBe(600)
    expect(stepInterval(4, false)).toBe(150)
    expect(stepInterval(1, true)).toBe(900)
  })

  it('the block scrubber seeks (UAT cu-6 P3-2): a click lands on its block, a jump to the end is not "seen", predict is not skipped', () => {
    const qs = new Map()
    expect([0, 0.001, 0.5, 0.999, 1].map(f => scrubStep(f, 56))).toEqual([1, 1, 29, 56, 56])
    expect(scrubStep(-0.2, 56)).toBe(0)
    expect(scrubStep(0.5, 120)).toBe(62) // 60 blocks over 120 steps: block 31 is step 62
    let s = drive(initialPlayer(56), qs, { type: 'seek', k: 28 })
    expect([s.k, s.jumped, s.playing]).toEqual([28, false, false])
    s = drive(s, qs, { type: 'seek', k: 56 })
    expect([s.k, s.jumped]).toEqual([56, true])
    s = drive(s, qs, { type: 'seek', k: 55 }, { type: 'seek', k: 56 })
    expect([s.k, s.jumped]).toEqual([56, false]) // one block at a time reaches the end by scrubbing through
    s = drive(s, qs, { type: 'seek', k: 0 })
    expect(s.k).toBe(0)
    s = drive(initialPlayer(56), qs, { type: 'forward' }, { type: 'play' }, { type: 'seek', k: 10 })
    expect([s.k, s.playing]).toEqual([10, true]) // scrubbing while it plays keeps playing
    s = drive(initialPlayer(56), qs, { type: 'predict', on: true }, { type: 'seek', k: 30 })
    expect(s.k).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import type { HelpRung } from '../../src/data/types'
import {
  announceText, deepestOf, helpUsed, ladderView, newlyUnlocked, sessionRungs, spentOf, spentOn,
  spentText, ticketNet, whyText, xpSavedText, type UseLike,
} from '../../src/rules/ladderView'

const use = (rung: HelpRung, cost: number, level?: 1 | 2): UseLike => ({ rung, cost, ...(level ? { level } : {}) })
const base = { uses: [] as UseLike[], elapsedSec: 0, gaveUp: false, redo: false }
const col = <K extends 'state' | 'cost' | 'cube' | 'name'>(v: ReturnType<typeof ladderView>, k: K) => v.map(r => r[k])

describe('ladderView', () => {
  it('H-01 initial DSA ladder', () => {
    const v = ladderView({ ...base, kind: 'problem' })
    expect(col(v, 'name')).toEqual(['attempt', 'hint', 'picture', 'video', 'solution'])
    expect(col(v, 'state')).toEqual(['open', 'locked', 'locked', 'locked', 'locked'])
    expect(col(v, 'cost')).toEqual([0, 2, 3, 3, 5])
    expect(col(v, 'cube')).toEqual(['0', '−2', '−3', '−3', '−5'])
    expect(v[0].buttonLabel).toBe('Attempt, opened')
    expect(v[1].buttonLabel).toBe('Hint, locked, costs 2 xp')
    expect(v[4].buttonLabel).toBe('Solution, locked until you give up')
  })

  it('H-02 design and task costs; task Solution is not available', () => {
    expect(col(ladderView({ ...base, kind: 'design' }), 'cost')).toEqual([0, 3, 4, 3, 5])
    const task = ladderView({ ...base, kind: 'stage' })
    expect(col(task, 'cost')).toEqual([0, 2, 2, 0, null])
    expect(task[4]).toMatchObject({ state: 'na', buttonLabel: 'Solution, not available for tasks', cube: 'n/a' })
    expect(col(ladderView({ ...base, kind: 'task' }), 'cost')).toEqual([0, 2, 2, 0, null])
  })

  it('H-03 Hint unlocks at exactly 600 s of timer', () => {
    expect(ladderView({ ...base, kind: 'problem', elapsedSec: 599 })[1].state).toBe('locked')
    const v = ladderView({ ...base, kind: 'problem', elapsedSec: 600 })
    expect(v[1]).toMatchObject({ state: 'unlocked', buttonLabel: 'Open Hint, costs 2 xp' })
  })

  it('Picture after Hint, Video after Picture, Solution only after Give up (H-05, H-09, H-10)', () => {
    let v = ladderView({ ...base, kind: 'problem', elapsedSec: 600, uses: [use(2, 2)] })
    expect(col(v, 'state')).toEqual(['open', 'open', 'unlocked', 'locked', 'locked'])
    expect(v[1].buttonLabel).toBe('Hint, opened')
    v = ladderView({ ...base, kind: 'problem', elapsedSec: 600, uses: [use(2, 2), use(3, 3), use(4, 3)] })
    expect(v[4].state).toBe('locked')
    v = ladderView({ ...base, kind: 'problem', gaveUp: true })
    expect(v[4]).toMatchObject({ state: 'unlocked', buttonLabel: 'Open Solution, costs 5 xp' })
    expect(v[1].state).toBe('locked')
  })

  it('H-27 a redo doubles Picture, Video and Solution only', () => {
    expect(col(ladderView({ ...base, kind: 'problem', redo: true }), 'cost')).toEqual([0, 2, 6, 6, 10])
    expect(col(ladderView({ ...base, kind: 'design', redo: true }), 'cost')).toEqual([0, 3, 8, 6, 10])
    expect(col(ladderView({ ...base, kind: 'stage', redo: true }), 'cost')).toEqual([0, 2, 4, 0, null])
  })
})

describe('ledger arithmetic', () => {
  it('spent sums costs; help counts a zero-cost rung; deepest and session rungs', () => {
    const uses = [use(2, 2, 1), use(2, 2, 2), use(3, 2), use(4, 0)]
    expect(spentOf(uses)).toBe(6)
    expect(spentOn(uses, 2)).toBe(4)
    expect(helpUsed([use(4, 0)])).toBe(true)
    expect(helpUsed([])).toBe(false)
    expect(deepestOf([])).toBe(1)
    expect(deepestOf(uses)).toBe(4)
    expect(sessionRungs(uses)).toEqual([1, 2, 3, 4])
  })

  it('ticketNet counts base only once solved and floors the sum once', () => {
    expect(ticketNet({ base: 10, solvedEver: false, applied: 13, refunds: 0 })).toBe(0)
    expect(ticketNet({ base: 10, solvedEver: true, applied: 2, refunds: 0 })).toBe(8)
    expect(ticketNet({ base: 5, solvedEver: true, applied: 8, refunds: 0 })).toBe(0)
    expect(ticketNet({ base: 10, solvedEver: true, applied: 10, refunds: 5 })).toBe(5)
    expect(ticketNet({ base: 10, solvedEver: true, applied: 12, refunds: 5 })).toBe(3)
  })
})

describe('announcer and texts', () => {
  it('newlyUnlocked reports the rung that went locked → unlocked, never on the first render', () => {
    const a = ladderView({ ...base, kind: 'problem', elapsedSec: 600 })
    const b = ladderView({ ...base, kind: 'problem', elapsedSec: 600, uses: [use(2, 2)] })
    expect(newlyUnlocked(null, a)).toBeNull()
    expect(announceText(newlyUnlocked(ladderView({ ...base, kind: 'problem' }), a)!)).toBe('Hint unlocked, costs 2 xp')
    expect(announceText(newlyUnlocked(a, b)!)).toBe('Picture unlocked, costs 3 xp')
    expect(newlyUnlocked(b, b)).toBeNull()
  })

  it('texts', () => {
    expect(whyText('Hint', 2)).toBe('Why did I pay for this? Hint cost 2 xp.')
    expect(spentText(13)).toBe('Help spent: 13 xp')
    expect(xpSavedText(8)).toBe('+8 xp · Saved')
    expect(xpSavedText(0)).toBe('+0 xp · Saved')
    expect(xpSavedText(-2)).toBe('−2 xp · Saved')
  })
})

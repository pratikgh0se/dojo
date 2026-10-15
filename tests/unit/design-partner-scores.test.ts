import { describe, expect, it } from 'vitest'
import { INTERVIEW_RUBRIC } from '../../src/ai/prompts'
import { DIVE_MAX, emptyPartnerScores, followUps, normalizePartnerScores, openingLine, PARTNER_ROWS, partnerComplete, partnerTotal, prefillFromPartner, ROW_MAX, setDive, setRow } from '../../src/rules/partnerScores'

describe('rows', () => {
  it('are the rubric items, five rows scored 0 to 4 for a total of 20', () => {
    expect(PARTNER_ROWS.map(r => r.item)).toEqual(INTERVIEW_RUBRIC.map(r => r.item))
    expect(PARTNER_ROWS.map(r => r.n)).toEqual([1, 2, 3, 4, 5])
    expect(ROW_MAX * PARTNER_ROWS.length).toBe(20)
    expect(DIVE_MAX).toBe(2)
  })
})
describe('scores', () => {
  it('start empty, take 1-based rows, clamp to range, and null clears', () => {
    let s = emptyPartnerScores()
    expect(s).toEqual({ perItem: [null, null, null, null, null], deepDives: [null, null, null, null] })
    s = setRow(s, 1, 3); s = setRow(s, 5, 9); s = setDive(s, 2, 1); s = setDive(s, 4, 7)
    expect(s.perItem).toEqual([3, null, null, null, 4])
    expect(s.deepDives).toEqual([null, 1, null, 2])
    expect(setRow(s, 1, null).perItem[0]).toBeNull()
  })
  it('totals only the scored rows and is complete when all five are', () => {
    let s = emptyPartnerScores()
    expect(partnerTotal(s)).toBe(0)
    for (let n = 1; n <= 5; n++) s = setRow(s, n, 3)
    expect(partnerTotal(s)).toBe(15)
    expect(partnerComplete(s)).toBe(true)
    expect(partnerComplete(setRow(s, 2, null))).toBe(false)
  })
  it('normalises anything stored', () => {
    expect(normalizePartnerScores(undefined)).toEqual(emptyPartnerScores())
    expect(normalizePartnerScores({ perItem: [1, 'x', 99, null], deepDives: [0, 2, 5] })).toEqual({ perItem: [1, null, 4, null, null], deepDives: [0, 2, null, null] })
  })
})
describe('follow-up questions (DESIGN-58)', () => {
  it('are the four deep dives then two generic push-backs, the last two marked generic', () => {
    const f = followUps(['a', 'b', 'c', 'd'])
    expect(f).toHaveLength(6)
    expect(f.map(x => x.generic)).toEqual([false, false, false, false, true, true])
    expect(f[0].text).toBe('a')
    expect(f.map(x => x.n)).toEqual([1, 2, 3, 4, 5, 6])
    expect(openingLine('Design a photo editor')).toContain('Design a photo editor')
  })
})
describe('prefillFromPartner', () => {
  const dives = ['a', 'b', 'c', 'd'].map(q => ({ q, answered: null as 0 | 1 | 2 | null }))
  it('prefills the rubric only when all five rows are scored; deep dives one by one, tagged partner', () => {
    const partial = prefillFromPartner({ perItem: [3, 3, 3, null, null], deepDives: [2, null, 1, null] }, dives, null)
    expect(partial.rubric).toBeNull()
    expect(partial.deepDives.map(d => [d.answered, d.by])).toEqual([[2, 'partner'], [null, undefined], [1, 'partner'], [null, undefined]])
    expect(prefillFromPartner({ perItem: [3, 3, 3, 3, 2], deepDives: [null, null, null, null] }, dives, null).rubric).toBe(14)
    expect(prefillFromPartner(undefined, dives, null)).toEqual({ deepDives: dives, rubric: null })
  })
  it('keeps the existing cap: the dive he could not answer without notes cannot be a 2', () => {
    expect(prefillFromPartner({ perItem: [null, null, null, null, null], deepDives: [2, 2, 2, 2] }, dives, 1).deepDives.map(d => d.answered)).toEqual([2, 1, 2, 2])
  })
})

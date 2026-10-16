import { describe, expect, it } from 'vitest'
import { FLOOR_CARDS, floorQueue, WELCOME_LINE } from '../../src/rules/floor'

const c = (id: string) => ({ id })
describe('floorQueue', () => {
  it('keeps the snapshot order, drops cards that are no longer due (graded) and cards set aside', () => {
    const cards = ['a', 'b', 'd', 'c'].map(c) // "e" was graded away
    expect(floorQueue(cards, ['a', 'b', 'c', 'e'], []).map(x => x.id)).toEqual(['a', 'b', 'c'])
    expect(floorQueue(cards, ['a', 'b', 'c', 'e'], ['b']).map(x => x.id)).toEqual(['a', 'c'])
    expect(floorQueue(cards, ['a', 'b', 'c', 'e'], ['a', 'b', 'c']).map(x => x.id)).toEqual([])
  })
  it('a card that arrives after the snapshot is not part of the session', () => {
    expect(floorQueue(['a', 'z'].map(c), ['a'], []).map(x => x.id)).toEqual(['a'])
  })
  it('constants', () => {
    expect(FLOOR_CARDS).toBe(5)
    expect(WELCOME_LINE).toBe('Welcome back. A short one is plenty today.')
  })
})

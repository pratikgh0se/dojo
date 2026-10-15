import { describe, expect, it } from 'vitest'
import { baseXp, levelOf, possibleXp, totalXp } from '../../src/rules/xp'
import { mkTicket, smallTickets } from '../helpers/tickets'

describe('xp', () => {
  it('pays base XP by kind and difficulty', () => {
    expect(baseXp('task')).toBe(10)
    expect(baseXp('problem', 'E')).toBe(5)
    expect(baseXp('problem', 'M')).toBe(10)
    expect(baseXp('problem', 'H')).toBe(15)
    expect(baseXp('problem')).toBe(10)
    expect(baseXp('design', 'H')).toBe(20)
    expect(baseXp('stage')).toBe(10)
  })
  it('computes level as floor(xp/10)', () => {
    expect(levelOf(0)).toBe(0)
    expect(levelOf(9)).toBe(0)
    expect(levelOf(65)).toBe(6)
  })
  it('totals earned XP including archived tickets', () => {
    const ts = [mkTicket({ id: 'a', xp: 10 }), mkTicket({ id: 'b', xp: 15, archived: true }), mkTicket({ id: 'c' })]
    expect(totalXp(ts)).toBe(25)
  })
  it('computes possible plan XP over non-archived plan tickets', () => {
    expect(possibleXp(smallTickets())).toBe(130)
    const archived = smallTickets().map(t => (t.kind === 'design' ? { ...t, archived: true } : t))
    expect(possibleXp(archived)).toBe(90)
  })
})

describe('R1 kinds', () => {
  it('pay the spec defaults', () => {
    expect(baseXp('watch')).toBe(10)
    expect(baseXp('read')).toBe(10)
    expect(baseXp('build')).toBe(20)
    expect(baseXp('writeup')).toBe(20)
    expect(baseXp('ritual')).toBe(5)
  })
})

import { describe, expect, it } from 'vitest'
import { bankItemXp, isBankOrigin } from '../../src/rules/bankTickets'
import { cfXp, baseXp } from '../../src/rules/xp'

describe('isBankOrigin', () => {
  it('is true only for bank:* and mine origins', () => {
    expect(isBankOrigin('bank:neetcode150')).toBe(true)
    expect(isBankOrigin('bank:codeforces')).toBe(true)
    expect(isBankOrigin('mine')).toBe(true)
  })

  it('treats plan, unknown and missing origin as NOT bank (they behave like plan)', () => {
    expect(isBankOrigin('plan')).toBe(false)
    expect(isBankOrigin('something-unexpected')).toBe(false)
    expect(isBankOrigin(undefined)).toBe(false)
    expect(isBankOrigin(null)).toBe(false)
    expect(isBankOrigin('')).toBe(false)
  })
})

describe('bankItemXp', () => {
  it('uses cfXp for a numeric difficulty (a shipped/imported Codeforces entry)', () => {
    expect(bankItemXp({ kind: 'problem', difficulty: 1600 })).toBe(cfXp(1600))
  })

  it('falls back to the carried rating when difficulty is the E/M/H bucket (a known Codeforces item added via Mine)', () => {
    expect(bankItemXp({ kind: 'problem', difficulty: 'M', rating: 1600 })).toBe(cfXp(1600))
    expect(bankItemXp({ kind: 'problem', difficulty: 'M', rating: 1600 })).not.toBe(baseXp('problem', 'M'))
  })

  it('uses baseXp when there is neither a numeric difficulty nor a rating', () => {
    expect(bankItemXp({ kind: 'problem', difficulty: 'E' })).toBe(baseXp('problem', 'E'))
  })

  it('design items always use the design base XP, rating or not', () => {
    expect(bankItemXp({ kind: 'design', difficulty: null })).toBe(baseXp('design'))
  })
})

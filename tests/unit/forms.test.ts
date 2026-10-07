import { describe, expect, it } from 'vitest'
import { FORMS, FORM_THRESHOLDS, formOf } from '../../src/rules/forms'
import { possibleXp } from '../../src/rules/xp'
import { smallTickets } from '../helpers/tickets'

describe('forms', () => {
  it('has nine forms and the spec thresholds', () => {
    expect(FORMS).toEqual(['BASE', 'KINDLE', 'SURGE', 'TEMPEST', 'PRIMAL', 'ZENITH', 'AZURE', 'VOID', 'SOVEREIGN'])
    expect(FORM_THRESHOLDS).toEqual([0, 0.05, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.0])
  })
  it('starts at BASE and reports XP to the next form', () => {
    expect(formOf(0, 6015)).toMatchObject({ index: 0, name: 'BASE', nextName: 'KINDLE', toNext: 301, segOn: 0 })
    expect(formOf(300, 6015)).toMatchObject({ name: 'BASE', toNext: 1 })
  })
  it('crosses a threshold exactly at the share', () => {
    expect(formOf(301, 6015)).toMatchObject({ index: 1, name: 'KINDLE', nextName: 'SURGE' })
    expect(formOf(18, 120)).toMatchObject({ name: 'SURGE' })
  })
  it('fills 12 meter segments between thresholds', () => {
    expect(formOf(150, 1000).segOn).toBe(0)
    expect(formOf(225, 1000).segOn).toBe(6)
  })
  it('tops out at SOVEREIGN at 100%', () => {
    expect(formOf(6015, 6015)).toMatchObject({ index: 8, name: 'SOVEREIGN', nextName: null, toNext: 0, segOn: 12 })
  })
  it('never divides by zero', () => {
    expect(formOf(10, 0)).toMatchObject({ name: 'BASE', share: 0 })
  })
  it('recomputes against the denominator after archiving', () => {
    const all = smallTickets()
    expect(formOf(5, possibleXp(all)).name).toBe('BASE')
    const archived = all.map(t => (t.kind === 'design' ? { ...t, archived: true } : t))
    expect(formOf(5, possibleXp(archived)).name).toBe('KINDLE')
  })
})

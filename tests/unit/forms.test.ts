import { describe, expect, it } from 'vitest'
import { FORMS, FORM_LV, formOf, formToStore } from '../../src/rules/forms'

describe('forms: fixed LV thresholds', () => {
  it('has nine forms in the original order and the fixed LV ladder', () => {
    expect(FORMS).toEqual(['BASE', 'KINDLE', 'SURGE', 'TEMPEST', 'PRIMAL', 'ZENITH', 'AZURE', 'VOID', 'SOVEREIGN'])
    expect(FORM_LV).toEqual([0, 10, 40, 100, 180, 300, 450, 650, 900])
  })
  it('starts at BASE and reports XP to the next form (LV = floor(xp / 10))', () => {
    expect(formOf(0)).toMatchObject({ index: 0, name: 'BASE', nextName: 'KINDLE', toNext: 100, segOn: 0 })
    expect(formOf(99)).toMatchObject({ index: 0, name: 'BASE', toNext: 1 })
  })
  it('changes form exactly at each threshold LV', () => {
    FORM_LV.forEach((lv, i) => {
      expect(formOf(lv * 10).index).toBe(i)
      if (lv > 0) expect(formOf(lv * 10 - 1).index).toBe(i - 1)
    })
    expect(formOf(100)).toMatchObject({ name: 'KINDLE', nextName: 'SURGE', toNext: 300 })
    expect(formOf(1000)).toMatchObject({ name: 'TEMPEST', nextName: 'PRIMAL', toNext: 800 })
  })
  it('lights segments by progress inside the current form: floor(12 x (xp - from) / (to - from))', () => {
    expect(formOf(100).segOn).toBe(0)
    expect(formOf(124).segOn).toBe(0)
    expect(formOf(125).segOn).toBe(1) // KINDLE spans 100..400 XP, 25 XP a segment
    expect(formOf(250).segOn).toBe(6)
    expect(formOf(395).segOn).toBe(11) // LV 39: 5 XP short of SURGE
    expect(formOf(399).segOn).toBe(11)
    expect(formOf(0).segOn).toBe(0) // BASE spans 0..100
    expect(formOf(250)).toMatchObject({ fromXp: 100, untilXp: 400 })
  })
  it('SOVEREIGN is final: no next form, a full meter', () => {
    expect(formOf(9000)).toMatchObject({ index: 8, name: 'SOVEREIGN', nextName: null, toNext: 0, segOn: 12 })
    expect(formOf(99999).index).toBe(8)
  })
  it('never regresses: the shown form is the larger of the computed form and the stored maximum', () => {
    expect(formOf(0, 1)).toMatchObject({ index: 1, name: 'KINDLE', nextName: 'SURGE', toNext: 400, segOn: 0 })
    expect(formOf(500, 1).index).toBe(2) // computed wins when it is higher
    expect(formOf(500, undefined).index).toBe(2)
    expect(formOf(0, 8)).toMatchObject({ name: 'SOVEREIGN', nextName: null })
  })
})

describe('formToStore: the write rule', () => {
  it('stores the computed form only when it exceeds the stored maximum', () => {
    expect(formToStore(100, undefined)).toBe(1)
    expect(formToStore(100, 0)).toBe(1)
    expect(formToStore(1000, 1)).toBe(3)
  })
  it('stores nothing at BASE with nothing stored, when equal, or when LV fell below the stored form', () => {
    expect(formToStore(0, undefined)).toBeNull()
    expect(formToStore(100, 1)).toBeNull()
    expect(formToStore(0, 1)).toBeNull()
    expect(formToStore(30, 5)).toBeNull()
  })
})

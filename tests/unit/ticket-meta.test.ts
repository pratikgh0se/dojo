import { describe, expect, it } from 'vitest'
import { LANE_LABEL, plainTitle, tagLane, verbObject, verbWord } from '../../src/rules/ticketMeta'
import { mkTicket } from '../helpers/planV2'

describe('ticketMeta', () => {
  it('shows the title verbatim (rulings R2) and builds VERB · OBJECT labels from the kind label', () => {
    expect(plainTitle({ kind: 'problem', title: '200 · Number of Islands' })).toBe('200 · Number of Islands')
    expect(plainTitle({ kind: 'watch', title: '3 · stays' })).toBe('3 · stays')
    expect(verbObject('START', 'watch')).toBe('START · WATCH')
    expect(verbObject('START', 'writeup')).toBe('START · WRITE-UP')
    expect(verbObject('REDO', 'problem')).toBe('REDO · PROBLEM')
    expect(verbObject('DONE', 'build')).toBe('DONE · BUILD')
  })
  it('builds labels whose object is not a kind (GLOBAL-03 shape)', () => {
    expect(verbWord('start', 'review')).toBe('START · REVIEW')
    expect(verbWord('Resume', '12:40')).toBe('RESUME · 12:40')
    expect(verbWord('start', 'plan')).toBe('START · PLAN')
  })
  it('shows a bank ticket as DSA, in the label and in the tag lane', () => {
    expect(LANE_LABEL.bank).toBe('DSA')
    expect(LANE_LABEL.path).toBe('AI')
    expect(tagLane(mkTicket({ id: 'b1', origin: 'bank', lane: 'bank' }))).toBe('dsa')
    expect(tagLane(mkTicket({ id: 'p1' }))).toBe('path')
  })
})

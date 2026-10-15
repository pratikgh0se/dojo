import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { InterviewFinal } from '../../src/ai/types'
import { INTERVIEW_RUBRIC } from '../../src/ai/prompts'
import { finalTotal, RUBRIC_BREAKDOWN, RUBRIC_ITEM_MAX } from '../../src/rules/designSession'
import { GradeView } from '../../src/screens/designSession/GradeView'

const final = (over: Partial<InterviewFinal> = {}): InterviewFinal => ({
  done: true, score: 99,
  perItem: [4, 2, 3, 4, 2].map((p, i) => ({ item: ['Requirements and numbers', 'API and data model', 'High-level design that meets the numbers', 'Two deep dives with real trade-offs', 'Failure modes and operations'][i], points: p, note: `n${i}` })),
  oneThingToStudy: 'Partitioning.', deepDives: [2, 1, 1, 0],
  lenses: { load: 1, data: 1, consistency: 1, failure: 1, latency: 1, cost: 1, evolution: 1 }, ...over,
})

describe('GradeView (DESIGN-68 to 70)', () => {
  it('shows five items, each of its maximum, and a total that is the sum of the five (not the stored score)', () => {
    render(<GradeView final={final()} />)
    const g = screen.getByTestId('session-grade')
    expect(within(g).getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByTestId('session-grade-total')).toHaveTextContent('15 of 20')
    expect(finalTotal(final())).toBe(15)
    expect(g).toHaveTextContent('4 of 4')
    expect(g).toHaveTextContent('2 of 3')
  })

  it('DESIGN-68: item n has session-grade-item-n with data-score the integer points, and the total is their sum', () => {
    render(<GradeView final={final()} />)
    const scores = [1, 2, 3, 4, 5].map(n => screen.getByTestId(`session-grade-item-${n}`).getAttribute('data-score'))
    expect(scores).toEqual(['4', '2', '3', '4', '2'])
    expect(scores.reduce((a, s) => a + Number(s), 0)).toBe(15)
    expect(screen.getByTestId('session-grade-total')).toHaveTextContent('15 of 20')
    expect(screen.queryByTestId('session-grade-item-6')).toBeNull()
  })

  it('lists the stored inconsistencies under Checks to review, at most five, exactly as stored', () => {
    const inc = ['one', 'two', 'three', 'four', 'five', 'six', 'seven']
    render(<GradeView final={final({ inconsistencies: inc })} />)
    const box = screen.getByTestId('session-grade-inconsistencies')
    expect(within(box).getByRole('heading')).toHaveTextContent('Checks to review')
    expect(within(box).getAllByRole('listitem').map(li => li.textContent)).toEqual(inc.slice(0, 5))
    expect(screen.getByTestId('session-grade-total')).toHaveTextContent('15 of 20')
  })

  it('DESIGN-69: three stored strings show exactly three entries and leave the total unchanged', () => {
    const inc = ['a b', 'c d', 'e f']
    render(<GradeView final={final({ inconsistencies: inc })} />)
    expect(within(screen.getByTestId('session-grade-inconsistencies')).getAllByRole('listitem').map(li => li.textContent)).toEqual(inc)
    expect(screen.getByTestId('session-grade-total')).toHaveTextContent('15 of 20')
  })

  it('omits the checks box when there are none (absent or empty), and shows what a stronger version does when given', () => {
    const { unmount } = render(<GradeView final={final({ stronger: ['Names a partition key.', 'Draws the read path.'] })} />)
    expect(screen.queryByTestId('session-grade-inconsistencies')).toBeNull()
    expect(within(screen.getByTestId('session-grade-stronger')).getByRole('heading')).toHaveTextContent('What a stronger version does')
    expect(within(screen.getByTestId('session-grade-stronger')).getAllByRole('listitem')).toHaveLength(2)
    unmount()
    render(<GradeView final={final({ inconsistencies: [] })} />)
    expect(screen.queryByTestId('session-grade-inconsistencies')).toBeNull()
  })

  it('an old stored final (no new lists) still renders', () => {
    render(<GradeView final={final()} />)
    expect(screen.getByTestId('session-grade')).toHaveTextContent('One thing to study: Partitioning.')
    expect(screen.queryByTestId('session-grade-stronger')).toBeNull()
  })

  it('never says the word interview, and the stored score is ignored when the items exist', () => {
    render(<GradeView final={final({ score: 3 })} />)
    expect(document.body.textContent).not.toMatch(/interview/i)
    expect(screen.getByTestId('session-grade-total')).toHaveTextContent('15 of 20')
  })

  it('falls back to the stored score only when there are no items', () => {
    expect(finalTotal(final({ perItem: [], score: 11 }))).toBe(11)
  })
})

describe('a grade outside the rubric is held to it (carry-over: finalTotal)', () => {
  const pts = (...p: number[]) => final({ perItem: p.map((points, i) => ({ item: `i${i}`, points, note: 'n' })) })

  it('the maxima are the prompt rubric\'s', () => {
    expect([...RUBRIC_ITEM_MAX]).toEqual(INTERVIEW_RUBRIC.map(r => r.max))
    // the one literal left (the Score form's breakdown line) states the same five numbers
    expect([...RUBRIC_BREAKDOWN.matchAll(/\((\d+)\)/g)].map(m => Number(m[1]))).toEqual([...RUBRIC_ITEM_MAX])
  })

  it('6 of 4 is capped at 4: the total, the item score and the text agree', () => {
    const f = pts(6, 2, 3, 4, 2)
    expect(finalTotal(f)).toBe(15)
    render(<GradeView final={f} />)
    expect(screen.getByTestId('session-grade-item-1').getAttribute('data-score')).toBe('4')
    expect(screen.getByTestId('session-grade-item-1')).toHaveTextContent('4 of 4')
    expect(screen.getByTestId('session-grade-total')).toHaveTextContent('15 of 20')
  })

  it('negative and non-numbers count as 0, non-integers round, and the sum stays within 0..20', () => {
    expect(finalTotal(pts(-3, 2, 3, 4, 2))).toBe(11)
    expect(finalTotal(pts(Number.NaN, 2, 3, 4, 2))).toBe(11)
    expect(finalTotal(pts(2.5, 1.4, 3, 4, 2))).toBe(13) // 3 + 1 + 3 + 4 + 2
    expect(finalTotal(pts(99, 99, 99, 99, 99))).toBe(20)
    expect(finalTotal(pts(-9, -9, -9, -9, -9))).toBe(0)
    render(<GradeView final={pts(2.5, 1.4, 3, 4, 2)} />)
    const scores = [1, 2, 3, 4, 5].map(n => Number(screen.getByTestId(`session-grade-item-${n}`).getAttribute('data-score')))
    expect(scores).toEqual([3, 1, 3, 4, 2])
    expect(scores.reduce((a, b) => a + b, 0)).toBe(13)
    expect(screen.getByTestId('session-grade-total')).toHaveTextContent('13 of 20')
  })

  it('the stored score used when there are no items is clamped and rounded too', () => {
    expect(finalTotal(final({ perItem: [], score: 31 }))).toBe(20)
    expect(finalTotal(final({ perItem: [], score: -2 }))).toBe(0)
    expect(finalTotal(final({ perItem: [], score: 11.6 }))).toBe(12)
  })
})

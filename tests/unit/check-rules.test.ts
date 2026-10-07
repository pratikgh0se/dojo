import { describe, expect, it } from 'vitest'
import type { BriefQuestion, CheckResult } from '../../src/ai/types'
import { attemptScore, checkInputs, checkRedoDue, isAnswered, normalizeResults, passRule, unanswered } from '../../src/rules/check'

const v = (...verdicts: CheckResult['verdict'][]) => verdicts.map(verdict => ({ verdict }))
const Q: BriefQuestion[] = [
  { id: 'q1', kind: 'open', q: 'Explain', keyIdeas: ['a'] },
  { id: 'q2', kind: 'mcq', q: 'Which?', choices: ['T', 'Not T'], correct: 0 },
]

describe('pass rule', () => {
  it('every question passes, or at most one is partial and none fail', () => {
    expect(passRule(v('pass', 'pass', 'pass'))).toBe(true)
    expect(passRule(v('pass', 'partial', 'pass'))).toBe(true)
    expect(passRule(v('partial'))).toBe(true)
    expect(passRule(v('partial', 'partial'))).toBe(false)
    expect(passRule(v('pass', 'fail'))).toBe(false)
    expect(passRule(v('partial', 'fail'))).toBe(false)
    expect(passRule([])).toBe(false)
  })
})

describe('answers', () => {
  it('an open question needs text, an mcq a choice (0 counts)', () => {
    expect(isAnswered(Q[0], { id: 'q1', answer: '  ' })).toBe(false)
    expect(isAnswered(Q[0], { id: 'q1', answer: 'x' })).toBe(true)
    expect(isAnswered(Q[1], { id: 'q2', choice: 0 })).toBe(true)
    expect(isAnswered(Q[1], { id: 'q2' })).toBe(false)
    expect(isAnswered(Q[1], undefined)).toBe(false)
    expect(unanswered(Q, [{ id: 'q1', answer: 'x' }]).map(q => q.id)).toEqual(['q2'])
  })
  it('the job input merges questions and answers', () => {
    expect(checkInputs(Q, [{ id: 'q1', answer: 'x' }, { id: 'q2', choice: 1 }])).toEqual([
      { id: 'q1', kind: 'open', q: 'Explain', keyIdeas: ['a'], answer: 'x' },
      { id: 'q2', kind: 'mcq', q: 'Which?', choices: ['T', 'Not T'], correct: 0, choice: 1 },
    ])
  })
})

describe('normalizeResults', () => {
  const ok: CheckResult = { id: 'q1', verdict: 'partial', correction: 'more', pointer: 'Step 2' }
  it('keeps the model verdict for open questions and grades MCQs in code, whatever the model said', () => {
    const liar: CheckResult = { id: 'q2', verdict: 'pass', correction: '', pointer: '' }
    const r = normalizeResults(Q, [{ id: 'q1', answer: 'x' }, { id: 'q2', choice: 1 }], [ok, liar])
    expect(r[0]).toEqual(ok)
    expect(r[1]).toEqual({ id: 'q2', verdict: 'fail', correction: 'The answer is "T"', pointer: 'Step 1' })
    const right = normalizeResults(Q, [{ id: 'q1', answer: 'x' }, { id: 'q2', choice: 0 }], [ok, { id: 'q2', verdict: 'fail', correction: 'no', pointer: 'x' }])
    expect(right[1]).toEqual({ id: 'q2', verdict: 'pass', correction: '', pointer: '' })
  })
  it('a question the model skipped fails', () => {
    const r = normalizeResults(Q, [{ id: 'q1', answer: 'x' }, { id: 'q2', choice: 0 }], [])
    expect(r[0]).toMatchObject({ id: 'q1', verdict: 'fail' })
    expect(r[1].verdict).toBe('pass')
  })
})

describe('redo date and score', () => {
  it('the redo is 3 local days out, as YYYY-MM-DD', () => {
    expect(checkRedoDue(new Date(2026, 9, 6, 23, 30).getTime())).toBe('2026-10-09')
    expect(checkRedoDue(new Date(2026, 9, 30, 9, 0).getTime())).toBe('2026-11-02')
  })
  it('the card line avoids the dialog\'s verdict words', () => {
    expect(attemptScore(v('pass', 'fail'))).toBe('1 of 2 right')
  })
})

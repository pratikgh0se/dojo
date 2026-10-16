import { describe, expect, it } from 'vitest'
import { bundleText, checkReview, LAB_REVIEW_INVALID, passedAt, percent, weakItems } from '../../src/rules/labReview'

const RUBRIC = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }, { id: 'r4' }]
const BUNDLE = { writeup: '# Writeup\n\n## Problem\nThe first check needed one small answer.\n', files: [{ path: 'notes/c1.txt', diff: '+ok\n+my second answer' }, { path: 's.txt', note: 'withheld: looks like a secret' }] }
const Q = 'The first check needed one small answer.'
const item = (id: string, score: number, quotes: string[] = [], over: Record<string, unknown> = {}) => ({
  id, score, evidence: quotes.map(quote => ({ quote, file: 'WRITEUP.md', line: 4 })), stronger: `stronger ${id}`, ...over,
})
const reply = (items: unknown[], over: Record<string, unknown> = {}) => ({ items, summary: ' fine ', percent: 100, passed: true, ...over })

describe('percent and weakItems', () => {
  it('is floor(sum * 100 / (3 * items)): 83, 66 (not 67), 25, 100, 0', () => {
    const p = (...s: number[]) => percent(s.map(score => ({ score })))
    expect(p(3, 2, 3, 2)).toBe(83)
    expect(p(3, 2, 2, 1)).toBe(66)
    expect(p(1, 0, 1, 1)).toBe(25)
    expect(p(3, 3, 3, 3)).toBe(100)
    expect(p(0, 0, 0)).toBe(0)
    expect(percent([])).toBe(0)
    expect(p(2, 2, 2)).toBe(66)
  })
  it('70 passes, 69 does not', () => {
    expect(passedAt(70)).toBe(true)
    expect(passedAt(69)).toBe(false)
    expect(percent([3, 3, 3, 3, 1, 1, 1, 1, 1, 0].map(score => ({ score })))).toBe(56)
    expect(percent([3, 3, 1].map(score => ({ score })))).toBe(77)
  })
  it('weakItems are the ones scored 0 or 1', () => {
    expect(weakItems([{ score: 3 }, { score: 1 }, { score: 0 }, { score: 2 }]).map(i => i.score)).toEqual([1, 0])
  })
})

describe('checkReview', () => {
  it('a good reply: items in rubric order, quotes kept, the model\'s percent and passed ignored, the summary trimmed', () => {
    const r = checkReview(reply([item('r3', 3, [Q]), item('r1', 3, [Q]), item('r4', 2, ['+ok']), item('r2', 2, ['my second answer'])]), BUNDLE, RUBRIC)
    expect(r).toMatchObject({ ok: true, summary: 'fine' })
    if (!r.ok) return
    expect(r.items.map(i => [i.id, i.score])).toEqual([['r1', 3], ['r2', 2], ['r3', 3], ['r4', 2]])
    expect(r.items[0].evidence).toEqual([{ quote: Q, file: 'WRITEUP.md', line: 4 }])
    expect(r).not.toHaveProperty('percent')
    expect(percent(r.items)).toBe(83)
  })

  it('a quote must be in the work: from the write-up or a diff; an invented one is dropped and a score of 2 or 3 left bare is capped at 1', () => {
    const r = checkReview(reply([
      item('r1', 3, [Q]), item('r2', 2, [Q, 'This sentence is not in the work.']), item('r3', 3, ['This sentence is not in the work.']), item('r4', 0),
    ]), BUNDLE, RUBRIC)
    if (!r.ok) throw new Error(r.error)
    expect(r.items.map(i => i.score)).toEqual([3, 2, 1, 0])
    expect(r.items[1].evidence.map(e => e.quote)).toEqual([Q])
    expect(r.items[2].evidence).toEqual([])
    expect(percent(r.items)).toBe(50)
  })
  it('a quote from a note ("withheld") or from the model\'s own words is not in the work; a blank quote is dropped', () => {
    const r = checkReview(reply([item('r1', 2, ['withheld: looks like a secret']), item('r2', 2, ['  ']), item('r3', 1, ['nope']), item('r4', 3, [Q])]), BUNDLE, RUBRIC)
    if (!r.ok) throw new Error(r.error)
    expect(r.items.map(i => [i.score, i.evidence.length])).toEqual([[1, 0], [1, 0], [1, 0], [3, 1]])
  })
  it('LAB-71: an entry with no file, no line or a quote over 400 characters is dropped like a quote not in the work, and the score follows', () => {
    const long = 'L'.repeat(401)
    const bundle = { ...BUNDLE, writeup: `${BUNDLE.writeup}${long}\n` }
    const noFile = { quote: Q, line: 4 }
    const noLine = { quote: Q, file: 'WRITEUP.md' }
    const tooLong = { quote: long, file: 'WRITEUP.md', line: 5 }
    const r = checkReview(reply([
      item('r1', 3, [Q]), { ...item('r2', 2, [Q]), evidence: [{ quote: Q, file: 'WRITEUP.md', line: 4 }, tooLong] },
      { ...item('r3', 3), evidence: [noLine] }, { ...item('r4', 2), evidence: [noFile] },
    ]), bundle, RUBRIC)
    if (!r.ok) throw new Error(r.error)
    expect(r.items.map(i => [i.score, i.evidence.length])).toEqual([[3, 1], [2, 1], [1, 0], [1, 0]])
    expect(checkReview(reply([{ ...item('r1', 3), evidence: [tooLong] }, item('r2', 0), item('r3', 0), item('r4', 0)]), bundle, RUBRIC)).toMatchObject({ ok: true })
    const t = checkReview(reply([{ ...item('r1', 3), evidence: [{ quote: 'L'.repeat(400), file: 'WRITEUP.md', line: 5 }] }, item('r2', 0), item('r3', 0), item('r4', 0)]), { ...bundle, writeup: `${bundle.writeup}${'L'.repeat(400)}\n` }, RUBRIC)
    expect(t.ok && t.items[0]).toMatchObject({ score: 3, evidence: [{ line: 5 }] })
  })
  it('four real quotes store the first three; the cap applies after the drop rules', () => {
    const four = [Q, Q, Q, Q]
    const r = checkReview(reply([item('r1', 3, four), item('r2', 3, ['nope', Q, Q, Q, Q]), item('r3', 0), item('r4', 0)]), BUNDLE, RUBRIC)
    if (!r.ok) throw new Error(r.error)
    expect(r.items.map(i => i.evidence.length)).toEqual([3, 3, 0, 0])
  })
  it('low scores need no quote and keep theirs only when real', () => {
    const r = checkReview(reply([item('r1', 1, ['made up']), item('r2', 0), item('r3', 1, [Q]), item('r4', 1)]), BUNDLE, RUBRIC)
    if (!r.ok) throw new Error(r.error)
    expect(r.items.map(i => i.evidence.length)).toEqual([0, 0, 1, 0])
  })

  const bad: [string, unknown, RegExp][] = [
    ['not an object', 'no', /no items/],
    ['no items list', { items: 3 }, /no items/],
    ['a missing id', reply([item('r1', 3, [Q]), item('r2', 3, [Q]), item('r3', 3, [Q])]), /r4 is missing/],
    ['a repeated id', reply([item('r1', 3, [Q]), item('r1', 2, [Q]), item('r2', 3, [Q]), item('r3', 3, [Q]), item('r4', 3, [Q])]), /r1 appears twice/],
    ['an id that is not in the rubric', reply([item('r1', 3, [Q]), item('r2', 3, [Q]), item('r3', 3, [Q]), item('r4', 3, [Q]), item('r9', 3, [Q])]), /r9 is not in the rubric/],
    ['a score of 7', reply([item('r1', 7), item('r2', 3, [Q]), item('r3', 3, [Q]), item('r4', 3, [Q])]), /score must be an integer/],
    ['a score of -1', reply([item('r1', -1), item('r2', 3, [Q]), item('r3', 3, [Q]), item('r4', 3, [Q])]), /score/],
    ['a score of 2.5', reply([item('r1', 2.5, [Q]), item('r2', 3, [Q]), item('r3', 3, [Q]), item('r4', 3, [Q])]), /score/],
    ['a score given as text', reply([item('r1', '3' as unknown as number, [Q]), item('r2', 3, [Q]), item('r3', 3, [Q]), item('r4', 3, [Q])]), /score/],
    ['no stronger text', reply([item('r1', 3, [Q], { stronger: '  ' }), item('r2', 3, [Q]), item('r3', 3, [Q]), item('r4', 3, [Q])]), /stronger/],
    ['an item that is not an object', reply([5]), /no id/],
  ]
  it.each(bad)('is invalid for %s', (_n, r, re) => {
    const out = checkReview(r, BUNDLE, RUBRIC)
    expect(out.ok).toBe(false)
    expect(out.ok ? '' : out.error).toMatch(re)
  })
})

describe('bundleText and the invalid-reply line', () => {
  it('is the write-up and every diff, never a note', () => {
    const t = bundleText(BUNDLE)
    expect(t).toContain(Q)
    expect(t).toContain('+my second answer')
    expect(t).not.toContain('withheld')
  })
  it('the invalid line is the contract\'s copy', () => {
    expect(LAB_REVIEW_INVALID).toBe('The review did not come through in a form Dojo can read. Nothing is lost: Retry asks again.')
  })
})

describe('reviewResults (what the job is told of the latest run)', () => {
  const check = (i: number, detail = 'd') => ({ id: `c${i}`, name: `Check ${i}`, status: 'pass' as const, detail })
  it('is null for no results, clips long text and stops before 4000 bytes of JSON', async () => {
    const { reviewResults, RESULTS_JSON_MAX } = await import('../../src/rules/labReview')
    expect(reviewResults(null)).toBeNull()
    const long = reviewResults({ checks: [check(1, 'x'.repeat(1000))], summary: { pass: 1, fail: 0, skip: 0 } })!
    expect(long[0].detail).toHaveLength(160)
    const many = reviewResults({ checks: Array.from({ length: 150 }, (_, i) => check(i, 'y'.repeat(150))), summary: { pass: 150, fail: 0, skip: 0 } })!
    expect(many.length).toBeGreaterThan(5)
    expect(many.length).toBeLessThan(150)
    expect(JSON.stringify(many).length).toBeLessThanOrEqual(RESULTS_JSON_MAX)
  })
})

describe('reviewRedos (the Review cards of a review)', () => {
  const NOW = new Date(2026, 10, 4, 10).getTime()
  const rubric = [{ id: 'r1', text: 'Q1' }, { id: 'r2', text: 'Q2' }]
  const items = [
    { id: 'r1', score: 0 as const, evidence: [], stronger: 'S1' },
    { id: 'r2', score: 3 as const, evidence: [], stronger: 'S2' },
  ]
  const base = { labId: 'x', labTitle: 'Lab X', closingTicket: 'T3', items, rubric, nowMs: NOW }
  it('one open card per item scored 0 or 1, due the next local day, never for a strong item', async () => {
    const { reviewRedos } = await import('../../src/rules/labReview')
    expect(reviewRedos({ ...base, existing: [] })).toEqual([{
      id: 'lr-x-r1', ticketId: 'T3', source: 'lab_review', createdAt: NOW, stage: 0, due: '2026-11-05', passed: [], helpCost: 0, refunded: 0,
      piece: { topic: 'Lab X', question: 'Q1', answer: 'S1' },
    }])
  })
  it('an open card with the id gets nothing; a closed one is replaced', async () => {
    const { reviewRedos } = await import('../../src/rules/labReview')
    const old = { id: 'lr-x-r1', ticketId: 'T3', source: 'lab_review' as const, createdAt: 1, stage: 1 as const, due: '2026-11-01', passed: [true], helpCost: 0, refunded: 0 }
    expect(reviewRedos({ ...base, existing: [old] })).toEqual([])
    expect(reviewRedos({ ...base, existing: [{ ...old, closedAt: 5 }] })).toHaveLength(1)
  })
})

// R2 W2: the `lab_review` job: schema, prompt, validator, the fake provider's variants and the helper's request check.
import { describe, expect, it } from 'vitest'
import { fakeOutput } from '../../src/ai/fake'
import { jobPrompt, OUTPUT_EXAMPLES, OUTPUT_SCHEMAS } from '../../src/ai/prompts'
import { buildJobRequest, JOB_NAMES, type LabReviewContext, type LabReviewOutput } from '../../src/ai/types'
import { validateOutput } from '../../src/ai/validate'
import { runJob } from '../../src/ai/client'
import { EXTRA_JOBS, validateRequest } from '../../server/helper.mjs'

const WRITEUP = '# Writeup\n\n## Problem\nThe first check needed one small answer.\n\n## Approach\nI wrote one answer file for each check.\n'
const ctx = (over: Partial<LabReviewContext> = {}): LabReviewContext => ({
  bundle: {
    rubric: [{ id: 'r1', text: 'States the problem in one sentence.' }, { id: 'r2', text: 'Shows that every check was run.' }, { id: 'r3', text: 'Explains the approach.' }, { id: 'r4', text: 'Names one thing to change.' }],
    writeup: WRITEUP, files: [{ path: 'notes/c1.txt', diff: '+ok' }, { path: 'secret.txt', note: 'withheld: looks like a secret' }],
  },
  results: [{ id: 'c1', name: 'Step one answer', status: 'pass', detail: 'ok' }], ...over,
})
const ticket = { id: 'tlab.build.3', title: 'Tiny lab', track: 'ai' as const }
const req = (c = ctx()) => buildJobRequest('lab_review', ticket, c)
const run = (variant: string, c = ctx()) => fakeOutput('lab_review', req(c), variant)
const scores = (o: LabReviewOutput) => o.items.map(i => i.score)

describe('lab_review is a job', () => {
  it('is registered, served by the helper as an extra job, and has a schema and an example that validate', () => {
    expect(JOB_NAMES).toContain('lab_review')
    expect(EXTRA_JOBS).toContain('lab_review')
    expect(validateOutput('lab_review', OUTPUT_EXAMPLES.lab_review)).toEqual([])
    expect(OUTPUT_SCHEMAS.lab_review).toContain('every rubric id exactly once')
  })
  it('the helper refuses a request with no bundle or an empty rubric, and takes a good one', () => {
    const cfg = {} as never
    const body = (context: unknown) => ({ ticket, context })
    expect(() => validateRequest('lab_review', body({}), cfg)).toThrow(/bundle/)
    expect(() => validateRequest('lab_review', body({ bundle: { rubric: [] } }), cfg)).toThrow(/bundle/)
    expect(() => validateRequest('lab_review', { ticket: null, context: ctx() }, cfg)).toThrow(/ticket is required/)
    expect(validateRequest('lab_review', body(ctx()), cfg).request.context.bundle).toBeDefined()
  })
})

describe('the prompt', () => {
  it('names the rubric ids, the check results, WRITEUP.md and each diff as fenced learner data, and the files not shown', () => {
    const p = jobPrompt('lab_review', req())
    for (const s of ['r1: States the problem in one sentence.', 'c1 (Step one answer): pass - ok', '<<<LEARNER_TEXT', 'The first check needed one small answer.', 'Diff of notes/c1.txt:', 'secret.txt (withheld: looks like a secret)', 'OUTPUT SCHEMA (lab_review)']) expect(p, s).toContain(s)
  })
  it('copes with an empty context (no bundle, no results)', () => {
    expect(jobPrompt('lab_review', { ticket, context: {} })).toContain('WRITEUP.md: (empty)')
  })
})

describe('validateOutput(lab_review): the shape only', () => {
  const good = (): LabReviewOutput => JSON.parse(JSON.stringify(run('pass')))
  it('accepts the fake pass reply, extra keys included', () => { expect(validateOutput('lab_review', good())).toEqual([]) })
  const bad: [string, (o: LabReviewOutput) => void, RegExp][] = [
    ['no items', o => { o.items = [] }, /items/],
    ['a score of 4', o => { o.items[0].score = 4 }, /score/],
    ['a fractional score', o => { o.items[0].score = 2.5 }, /score/],
    ['a repeated id', o => { o.items[1].id = o.items[0].id }, /appears twice/],
    ['an empty stronger', o => { o.items[0].stronger = ' ' }, /stronger/],
    ['evidence that is not a list', o => { (o.items[0] as { evidence: unknown }).evidence = 'q' }, /evidence/],
    ['a stronger text over 80 words', o => { o.items[0].stronger = Array(81).fill('w').join(' ') }, /words/],
    ['no summary', o => { delete (o as Partial<LabReviewOutput>).summary }, /summary/],
  ]
  it('LAB-71: a malformed evidence entry (no file, no line, 401 characters) does not make the reply unusable', () => {
    for (const ev of [{ quote: 'q', file: '', line: 1 }, { quote: 'q', file: 'f' }, { quote: 'q'.repeat(401), file: 'f', line: 1 }]) {
      const o = good()
      o.items[0].evidence = [ev as LabReviewOutput['items'][number]['evidence'][number]]
      expect(validateOutput('lab_review', o)).toEqual([])
    }
  })
  it('more than 3 evidence entries do not make the reply unusable', () => {
    const o = good()
    o.items[0].evidence = Array.from({ length: 4 }, () => ({ quote: 'q', file: 'f', line: 1 }))
    expect(validateOutput('lab_review', o)).toEqual([])
  })
  it.each(bad)('rejects %s', (_n, mutate, re) => {
    const o = good()
    mutate(o)
    expect(validateOutput('lab_review', o).join('\n')).toMatch(re)
  })
})

describe('the fake provider (contracts README, "Fake AI provider")', () => {
  it('pass is the default, and an unknown variant means pass', () => {
    expect(scores(run('default'))).toEqual([3, 2, 3, 2])
    expect(scores(run('whatever'))).toEqual([3, 2, 3, 2])
  })
  it.each([['pass', [3, 2, 3, 2]], ['pass-weak', [3, 3, 3, 1]], ['borderline', [3, 2, 2, 1]], ['not-yet', [1, 0, 1, 1]], ['fabricated', [3, 2, 3, 0]]])('%s scores %j', (v, want) => {
    const out = run(v)
    expect(scores(out)).toEqual(want)
    expect(validateOutput('lab_review', out)).toEqual([])
  })
  it('every reply claims percent 100 and passed, carries the fixed stronger and summary texts, and one item per rubric item', () => {
    const out = run('not-yet') as LabReviewOutput & { percent: number; passed: boolean }
    expect([out.percent, out.passed]).toEqual([100, true])
    expect(out.summary).toBe('[fake:review] Reviewed 4 items.')
    expect(out.items.map(i => i.stronger)).toEqual(['r1', 'r2', 'r3', 'r4'].map(id => `[fake:review] A stronger answer for ${id} adds one concrete detail.`))
  })
  it('a real quote is the first non-empty line of WRITEUP.md that is not a heading, with its 1-based line; not-yet quotes nothing', () => {
    const real = { quote: 'The first check needed one small answer.', file: 'WRITEUP.md', line: 4 }
    expect(run('pass').items.map(i => i.evidence)).toEqual([[real], [real], [real], [real]])
    expect(run('not-yet').items.map(i => i.evidence)).toEqual([[], [], [], []])
    expect(run('pass-weak').items.map(i => i.evidence.length)).toEqual([1, 1, 1, 0])
  })
  it('fabricated: r1 real, r2 real and made-up, r3 only made-up, r4 none', () => {
    const madeUp = { quote: 'This sentence is not in the work.', file: 'WRITEUP.md', line: 1 }
    const ev = run('fabricated').items.map(i => i.evidence)
    expect(ev[0]).toHaveLength(1)
    expect(ev[1]).toEqual([ev[0][0], madeUp])
    expect(ev[2]).toEqual([madeUp])
    expect(ev[3]).toEqual([])
  })
  it('malformed: r1 real, r2 real and a 401-character quote, r3 a real quote with no line, r4 none; the shape check takes it', () => {
    const out = run('malformed')
    expect(scores(out)).toEqual([3, 2, 3, 0])
    const ev = out.items.map(i => i.evidence)
    expect(ev[0]).toHaveLength(1)
    expect(ev[1]).toEqual([ev[0][0], { quote: 'x'.repeat(401), file: 'WRITEUP.md', line: 1 }])
    expect(ev[2]).toEqual([{ quote: ev[0][0].quote, file: 'WRITEUP.md' }])
    expect(ev[3]).toEqual([])
    expect(validateOutput('lab_review', out)).toEqual([])
  })
  it('the score list repeats for a rubric of another size; with no usable WRITEUP.md nothing is quoted', () => {
    const big = ctx({ bundle: { ...ctx().bundle, rubric: Array.from({ length: 5 }, (_, i) => ({ id: `r${i + 1}`, text: 't' })) } })
    expect(scores(run('pass', big))).toEqual([3, 2, 3, 2, 3])
    const stub = ctx({ bundle: { ...ctx().bundle, writeup: '# Writeup\n\n## Problem\n\n' } })
    expect(run('pass', stub).items.every(i => i.evidence.length === 0)).toBe(true)
  })
  it('invalid repeats r1 and gives a 7: the validator refuses it, and runJob reports invalid_output', async () => {
    const out = run('invalid')
    expect(out.items.map(i => i.id)).toEqual(['r1', 'r1', 'r2', 'r3', 'r4'])
    expect(validateOutput('lab_review', out).join('\n')).toMatch(/appears twice/)
    const store = { getItem: (k: string) => (k === 'dojo:fake-ai-lab_review' ? 'invalid' : null) }
    const r = await runJob('lab_review', req(), { config: { provider: 'fake', helperUrl: '' }, storage: store })
    expect(r).toMatchObject({ ok: false, code: 'invalid_output' })
    const ok = await runJob('lab_review', req(), { config: { provider: 'fake', helperUrl: '' }, storage: { getItem: () => null } })
    expect(ok.ok).toBe(true)
  })
})

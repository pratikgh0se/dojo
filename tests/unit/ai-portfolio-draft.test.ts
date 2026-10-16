// R2 W6: the `portfolio_draft` job (article and LinkedIn kinds): schema, prompt, validator, the fake provider's contract strings
// (portfolio.md, "Fake AI for portfolio_draft") and the helper's request check.
import { describe, expect, it } from 'vitest'
import { runJob } from '../../src/ai/client'
import { fakeOutput } from '../../src/ai/fake'
import { jobPrompt, OUTPUT_EXAMPLES, OUTPUT_SCHEMAS } from '../../src/ai/prompts'
import { buildJobRequest, JOB_NAMES, type PortfolioDraftContext, type PortfolioDraftOutput } from '../../src/ai/types'
import { PORTFOLIO_DRAFT_MAX_CHARS, validateOutput } from '../../src/ai/validate'
import { EXTRA_JOBS, readConfig, validateRequest } from '../../server/helper.mjs'
import { trimPost } from '../../src/rules/portfolioDrafts'

const ticket = { id: 'pf-a', title: 'Portfolio fixture lab A', track: 'ai' as const }
const ctx = (over: Partial<PortfolioDraftContext> = {}): PortfolioDraftContext =>
  ({ kind: 'article', writeup: '# W\n\n## Problem\nP\n', journal: ['2026-11-01', '2026-11-02: Closed form'], stronger: ['a', 'b', 'c'], results: '| Check | Result | Detail |', ...over })
const reqOf = (c: PortfolioDraftContext) => buildJobRequest('portfolio_draft', ticket, c)
const out = (c: PortfolioDraftContext) => fakeOutput('portfolio_draft', reqOf(c)) as PortfolioDraftOutput

describe('portfolio_draft job', () => {
  it('is a job name served by the helper as an extra job', () => {
    expect(JOB_NAMES).toContain('portfolio_draft')
    expect(EXTRA_JOBS).toContain('portfolio_draft')
  })

  it('fake article: the contract template over the lab title, n journal entries and m stronger versions', () => {
    const o = out(ctx())
    expect(o.text).toBe('# Portfolio fixture lab A\n\nFake article draft built from the write-up, 2 journal entries and 3 stronger versions.')
    expect(validateOutput('portfolio_draft', o)).toEqual([])
    expect(out(ctx({ journal: [], stronger: ['x', 'y'] })).text).toBe('# Portfolio fixture lab A\n\nFake article draft built from the write-up, 0 journal entries and 2 stronger versions.')
  })

  it('fake linkedin: the contract sentence', () => {
    expect(out(ctx({ kind: 'linkedin' })).text).toBe('Fake LinkedIn draft for Portfolio fixture lab A. Built from the write-up and 3 stronger versions.')
  })

  it('a FAKE-LONG line makes the LinkedIn reply 40 numbered sentences (1,759 characters) and trimPost cuts it to 29', () => {
    const writeup = '## Approach\nStart.\nFAKE-LONG\n\n## Results\nR\n'
    const long = out(ctx({ kind: 'linkedin', writeup })).text
    expect(long).toHaveLength(1759)
    expect(long.startsWith('Sentence 01 of the fake long LinkedIn post. Sentence 02 of the fake long LinkedIn post.')).toBe(true)
    expect(long.endsWith('Sentence 40 of the fake long LinkedIn post.')).toBe(true)
    expect(validateOutput('portfolio_draft', { text: long })).toEqual([])
    const t = trimPost(long)
    expect(t).toHaveLength(1275)
    expect(t.endsWith('Sentence 29 of the fake long LinkedIn post.')).toBe(true)
    // the marker does not change the article's shape
    expect(out(ctx({ writeup })).text).toBe('# Portfolio fixture lab A\n\nFake article draft built from the write-up, 2 journal entries and 3 stronger versions.')
  })

  it('a marker inside a longer line is not a marker', () => {
    expect(out(ctx({ kind: 'linkedin', writeup: 'we never say FAKE-LONG here' })).text).toMatch(/^Fake LinkedIn draft/)
  })

  it('a FAKE-INVALID line makes both kinds fail with the invalid-reply failure', async () => {
    const writeup = 'x\nFAKE-INVALID\n'
    for (const kind of ['article', 'linkedin'] as const) {
      const r = await runJob('portfolio_draft', reqOf(ctx({ kind, writeup })), { config: { provider: 'fake', helperUrl: '' }, storage: null })
      expect(r).toMatchObject({ ok: false, code: 'invalid_output' })
    }
  })

  it('takes at least 300 ms', async () => {
    const t0 = Date.now()
    const r = await runJob('portfolio_draft', reqOf(ctx()), { config: { provider: 'fake', helperUrl: '' }, storage: null })
    expect(r.ok).toBe(true)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(290)
  })

  const bad: [string, unknown, RegExp][] = [
    ['no text', {}, /text/], ['empty text', { text: '  ' }, /text/], ['a number', { text: 3 }, /text/],
    ['too long', { text: 'x'.repeat(PORTFOLIO_DRAFT_MAX_CHARS + 1) }, /characters/], ['an extra field', { text: 'ok', title: 'x' }, /unexpected/],
  ]
  it.each(bad)('rejects %s', (_n, o, re) => { expect(validateOutput('portfolio_draft', o).join('\n')).toMatch(re) })

  it('the prompt example is valid and the prompt fences the learner text', () => {
    expect(validateOutput('portfolio_draft', OUTPUT_EXAMPLES.portfolio_draft)).toEqual([])
    expect(OUTPUT_SCHEMAS.portfolio_draft).toContain('1300')
    const p = jobPrompt('portfolio_draft', reqOf(ctx()))
    expect(p).toContain('Dojo job: portfolio_draft.')
    expect(p).toMatch(/<<<LEARNER_TEXT .*## Problem.* LEARNER_TEXT>>>/s)
    expect(p).toContain('| Check | Result | Detail |')
  })

  it('the helper checks the request: kind and writeup are required, a ticket is required', () => {
    const cfg = readConfig([], {})
    expect(() => validateRequest('portfolio_draft', { ticket, context: ctx() }, cfg)).not.toThrow()
    expect(() => validateRequest('portfolio_draft', { ticket, context: { ...ctx(), kind: 'poem' } }, cfg)).toThrow(/kind/)
    expect(() => validateRequest('portfolio_draft', { ticket, context: { kind: 'article' } }, cfg)).toThrow(/writeup/)
    expect(() => validateRequest('portfolio_draft', { context: ctx() }, cfg)).toThrow(/ticket/)
  })
})

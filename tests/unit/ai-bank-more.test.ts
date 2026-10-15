// R1 W6: the `bank_more` job ("More questions", BANK-19): the fake returns five valid questions, the validator holds the qbank rules.
import { describe, expect, it } from 'vitest'
import { fakeOutput } from '../../src/ai/fake'
import { jobPrompt, OUTPUT_EXAMPLES, OUTPUT_SCHEMAS } from '../../src/ai/prompts'
import { JOB_NAMES, buildJobRequest, type BankMoreContext, type BankMoreOutput } from '../../src/ai/types'
import { validateOutput } from '../../src/ai/validate'
import { runJob } from '../../src/ai/client'
import { EXTRA_JOBS } from '../../server/helper.mjs'

const ctx: BankMoreContext = { area: 'design', node: 'SD01', nodeTitle: 'Estimation', nodeAbout: 'Back-of-envelope numbers.', avoid: ['Existing question one?'], count: 5 }
const req = buildJobRequest('bank_more', null, ctx)
const good = (): BankMoreOutput => JSON.parse(JSON.stringify(fakeOutput('bank_more', req))) as BankMoreOutput

describe('bank_more job', () => {
  it('is a job name, optional-ticket, and served by the helper as an extra job', () => {
    expect(JOB_NAMES).toContain('bank_more')
    expect(EXTRA_JOBS).toContain('bank_more')
  })

  it('the fake returns exactly five valid questions with all four types or at least two difficulties', () => {
    const out = good()
    expect(out.questions).toHaveLength(5)
    expect(validateOutput('bank_more', out)).toEqual([])
    expect(new Set(out.questions.map(q => q.difficulty)).size).toBeGreaterThanOrEqual(2)
    expect(new Set(out.questions.map(q => q.question)).size).toBe(5)
    for (const q of out.questions) expect(q.answer.trim().split(/\s+/).length).toBeLessThanOrEqual(120)
  })

  it('the fake names the node so five calls for two nodes differ', () => {
    const other = fakeOutput('bank_more', buildJobRequest('bank_more', null, { ...ctx, node: 'SD02', nodeTitle: 'Caching' })) as BankMoreOutput
    expect(other.questions[0].question).not.toBe(good().questions[0].question)
  })

  const bad: [string, (o: BankMoreOutput) => void, RegExp][] = [
    ['four questions', o => { o.questions.pop() }, /5/],
    ['a bad type', o => { (o.questions[0] as { type: string }).type = 'quiz' }, /type/],
    ['difficulty 6', o => { o.questions[0].difficulty = 6 }, /difficulty/],
    ['an empty question', o => { o.questions[1].question = '' }, /question/],
    ['a 121-word answer', o => { o.questions[2].answer = Array(121).fill('w').join(' ') }, /120/],
    ['an empty checklist', o => { o.questions[3].checklist = [] }, /checklist/],
    ['seven checklist items', o => { o.questions[3].checklist = ['1', '2', '3', '4', '5', '6', '7'] }, /checklist/],
    ['the word interview', o => { o.questions[4].question = 'How would you interview for this?' }, /interview/i],
    ['a source field', o => { (o.questions[0] as unknown as Record<string, unknown>).source = 'x' }, /source|field/],
  ]
  for (const [name, mutate, re] of bad) {
    it(`the validator refuses ${name}`, () => {
      const o = good()
      mutate(o)
      expect(validateOutput('bank_more', o).join('\n')).toMatch(re)
    })
  }

  it('has a schema, a valid example and a prompt that names the node and the questions to avoid', () => {
    expect(OUTPUT_SCHEMAS.bank_more).toContain('questions')
    expect(validateOutput('bank_more', OUTPUT_EXAMPLES.bank_more)).toEqual([])
    const p = jobPrompt('bank_more', req)
    expect(p).toContain('Estimation')
    expect(p).toContain('Existing question one?')
    expect(p).toMatch(/5/)
  })

  it('runJob in the fake provider returns the five questions with no ticket', async () => {
    const r = await runJob('bank_more', req, { config: { provider: 'fake', helperUrl: '' }, storage: null })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output.questions).toHaveLength(5)
  })

  it('the fake error variant fails gracefully with a code', async () => {
    const store = { getItem: (k: string) => (k === 'dojo:fake-ai-bank_more' ? 'error' : null) }
    const r = await runJob('bank_more', req, { config: { provider: 'fake', helperUrl: '' }, storage: store })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('claude_failed')
  })
})

describe('bank_more fake timing (README "Fake AI provider")', () => {
  it('takes at least 300 ms in the browser fake', async () => {
    const t0 = Date.now()
    await runJob('bank_more', req, { config: { provider: 'fake', helperUrl: '' }, storage: null })
    expect(Date.now() - t0).toBeGreaterThanOrEqual(295)
  })
})

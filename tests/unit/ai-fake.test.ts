import { describe, expect, it } from 'vitest'
import {
  FAKE_DIAGRAM, FAKE_PICTURE_STEPS, fakeOutput, fakeVariantKey, readFakeHooks,
} from '../../src/ai/fake'
import { AiJobError, JOB_NAMES, type AiTicket, type JobName, type JobRequest } from '../../src/ai/types'
import { validateOutput } from '../../src/ai/validate'

const T: AiTicket = { id: 'p200', title: 'Number of Islands', track: 'dsa' }
const store = (o: Record<string, string>) => ({ getItem: (k: string) => o[k] ?? null })

const REQ: { [J in JobName]: JobRequest<J> } = {
  hint: { ticket: T, context: { level: 1 } },
  picture: { ticket: T, context: { language: 'python' } },
  diagram: { ticket: { id: 'd-ratelimit', title: 'Rate limiter', track: 'design' }, context: { deepDives: ['a', 'b', 'c', 'd'] } },
  interview: { ticket: { id: 'd-ratelimit', title: 'Rate limiter', track: 'design' }, context: { turn: 0, answers: [], deepDives: ['a', 'b', 'c', 'd'] } },
  grade: { ticket: { id: 'art-stage-00', title: 'Setup', track: 'ai' }, context: { repoUrl: 'https://github.com/u/forge', commit: 'c0ffee1' } },
  solution: { ticket: T, context: { gave_up: true } },
  classify: { ticket: null, context: { input: 'https://leetcode.com/problems/maximum-number-of-robots-within-budget/' } },
  brief: { ticket: T, context: { kind: 'task', estMin: 50 } },
  check: { ticket: T, context: { questions: [{ id: 'q1', kind: 'open', q: 'x', answer: 'number of islands' }] } },
  bank_more: { ticket: null, context: { area: 'design', node: 'SD01', nodeTitle: 'Estimation', nodeAbout: 'Numbers.', avoid: [], count: 5 } },
}

describe('fake outputs (spec §4.6; contracts pin these strings)', () => {
  it.each([...JOB_NAMES])('%s default output passes validateOutput', job => {
    expect(validateOutput(job, fakeOutput(job, REQ[job] as never))).toEqual([])
  })

  it('hint echoes level and ticket id', () => {
    expect(fakeOutput('hint', REQ.hint)).toEqual({ hint: '[fake:hint] Level 1 nudge for p200: what stays true after every step?' })
    expect(fakeOutput('hint', { ticket: T, context: { level: 2 } })).toEqual({ hint: '[fake:hint] Level 2 nudge for p200: what stays true after every step?' })
  })

  it('picture is a 15-step max scan over [3,1,4,1,5]', () => {
    const p = fakeOutput('picture', REQ.picture)
    expect(p.title).toBe('[fake:picture] Max scan for p200')
    expect(p.complexity).toBe('O(n)')
    expect(p.structures).toEqual({ a: { type: 'array', values: [3, 1, 4, 1, 5] } })
    expect(p.code).toEqual(['best = 0', 'for i in 1..n-1', '  if a[i] > a[best]', '    best = i', 'return best'])
    expect(p.steps).toEqual(FAKE_PICTURE_STEPS)
    expect(p.steps).toHaveLength(15)
    expect(new Set(p.steps.map(s => s.op))).toEqual(new Set(['pointer', 'mark', 'compare']))
    expect(p.steps[14]).toEqual({ op: 'mark', s: 'a', i: 4, state: 'done', line: 4, say: 'Answer for this small input: 5 at index 4.' })
  })

  it('diagram is the design contract §7 reference, verbatim', () => {
    expect(fakeOutput('diagram', REQ.diagram)).toEqual({
      layout: 'layered',
      nodes: [
        { id: 'client', kind: 'browser', label: 'Client' },
        { id: 'gw', kind: 'gateway', label: 'Gateway' },
        { id: 'svc', kind: 'service', label: 'Service' },
        { id: 'store', kind: 'nosql', label: 'Counters' },
      ],
      links: [
        { from: 'client', to: 'gw', kind: 'sync' },
        { from: 'gw', to: 'svc', kind: 'sync' },
        { from: 'svc', to: 'store', kind: 'write' },
      ],
      zones: [],
      flows: [{ path: ['client', 'gw', 'svc', 'store'], packet: 'request', label: 'hot path' }],
    })
    const a = fakeOutput('diagram', REQ.diagram)
    a.nodes.pop()
    expect(FAKE_DIAGRAM.nodes).toHaveLength(4)
  })

  it('interview final grade (the closing-grade shape)', () => {
    const final = fakeOutput('interview', { ...REQ.interview, context: { ...REQ.interview.context, turn: 10, final: true } })
    // F3 adds feedback, evidence and missed (tests/unit/f3-grade-schema.test.ts); the closing-grade shape below is what it always was
    const { missed, ...rest } = final as unknown as { missed: unknown[]; perItem: Record<string, unknown>[] }
    expect(missed).toHaveLength(3)
    expect({ ...rest, perItem: rest.perItem.map(({ feedback, evidence, ...p }) => (feedback && evidence ? p : null)) }).toEqual({
      done: true,
      score: 15,
      perItem: [
        { item: 'Requirements and numbers', points: 4, note: '[fake:partner] d-ratelimit' },
        { item: 'API and data model', points: 2, note: '[fake:partner] d-ratelimit' },
        { item: 'High-level design that meets the numbers', points: 3, note: '[fake:partner] d-ratelimit' },
        { item: 'Two deep dives with real trade-offs', points: 4, note: '[fake:partner] d-ratelimit' },
        { item: 'Failure modes and operations', points: 2, note: '[fake:partner] d-ratelimit' },
      ],
      oneThingToStudy: '[fake:partner] d-ratelimit',
      deepDives: [2, 1, 2, 1],
      lenses: { load: 2, data: 1, consistency: 1, failure: 1, latency: 1, cost: 0, evolution: 1 },
      stronger: [
        '[fake:partner] d-ratelimit: names a partition key and shows how many partitions the numbers call for.',
        '[fake:partner] d-ratelimit: gives every box a line in the notes with its API call and its failure case.',
      ],
    })
  })

  it('the partner fake: one question ending in ?, no banned word, the title, and a Hint', () => {
    const ticket = { id: 'd-method', title: 'Design a photo editor', track: 'design' as const }
    for (let turn = 0; turn < 20; turn++) {
      const out = fakeOutput('interview', { ticket, context: { turn, answers: [], deepDives: ['a', 'b', 'c', 'd'] } }) as { say: string; done: false }
      expect(out.say, `turn ${turn}`).toMatch(/^\[fake:partner\]/)
      expect(out.say.match(/\?/g)).toHaveLength(1)
      expect(out.say.endsWith('?')).toBe(true)
      expect(out.say).not.toMatch(/interview|you could|you should|I suggest|consider using|the answer is|^\s*([-*]|\d+\.)\s/im)
      expect(validateOutput('interview', out)).toEqual([])
    }
    const first = fakeOutput('interview', { ticket, context: { turn: 0, answers: [], deepDives: [] } }) as { say: string }
    expect(first.say).toContain('Design a photo editor')
    const hint = fakeOutput('interview', { ticket, context: { turn: 4, answers: [], deepDives: [], hint: true } }) as { say: string }
    expect(hint.say).toMatch(/^\[fake:partner\] Hint/)
    expect(hint.say.match(/\?/g)).toHaveLength(1)
  })

  it('a title or id with a ? or the banned word still gives exactly one ? and no banned word (DESIGN-45)', () => {
    const ticket = { id: 'd-ddia', title: 'Design a limiter? (the interview kind)', track: 'design' as const }
    for (const hint of [false, true]) for (let turn = 0; turn < 14; turn++) {
      const out = fakeOutput('interview', { ticket, context: { turn, answers: [], deepDives: [], hint } }) as { say: string }
      expect(out.say.match(/\?/g), `turn ${turn} hint ${hint}`).toHaveLength(1)
      expect(out.say).not.toMatch(/interview/i)
    }
    const first = fakeOutput('interview', { ticket, context: { turn: 0, answers: [], deepDives: [] } }) as { say: string }
    expect(first.say).toContain('Design a limiter')
  })

  it('the closing-done variant says done:true without the banned word', () => {
    const out = fakeOutput('interview', REQ.interview, 'closing-done') as unknown as { say: string; done: boolean }
    expect(out.done).toBe(true)
    expect(out.say).not.toMatch(/interview/i)
  })

  it('the session grade fake: five items summing to the score, stronger always, inconsistencies on variant findings', () => {
    const req = { ticket: { id: 'd-method', title: 'D', track: 'design' as const }, context: { sessionGrade: true, deepDives: ['a', 'b', 'c', 'd'] } }
    const base = fakeOutput('grade', req) as unknown as { score: number; perItem: { points: number; note: string }[]; stronger: string[]; inconsistencies?: string[] }
    expect(base.perItem).toHaveLength(5)
    expect(base.perItem.reduce((a, p) => a + p.points, 0)).toBe(base.score)
    expect(base.stronger).toHaveLength(2)
    expect(base.inconsistencies ?? []).toEqual([])
    expect(base.perItem[0].note).toMatch(/^\[fake:partner\]/)
    const found = fakeOutput('grade', req, 'findings') as unknown as { inconsistencies: string[] }
    expect(found.inconsistencies).toHaveLength(3)
    expect(validateOutput('grade', found)).toEqual([])
  })

  it('grade default and low (projects contract §1)', () => {
    expect(fakeOutput('grade', REQ.grade)).toEqual({
      score: 4, max: 5, passed: true,
      feedback: ['[fake:grade] art-stage-00 runs, is hand-written, and is measured.'], missing: [], commitFound: true,
    })
    expect(fakeOutput('grade', REQ.grade, 'low')).toEqual({
      score: 2, max: 5, passed: false,
      feedback: ['[fake:grade] art-stage-00 runs but has no measurement.'],
      missing: ['[fake:grade] a measurement or test'], commitFound: true,
    })
  })

  it('solution', () => {
    expect(fakeOutput('solution', REQ.solution)).toEqual({
      approach: '[fake:solution] Approach for p200: keep one invariant and scan once.',
      pseudocode: ['best = first item', 'for each item', '  if item beats best: best = item', 'return best'],
      complexity: 'O(n) time · O(1) space',
      quiz: [
        { q: 'What stays true after every step?', a: 'best holds the answer so far' },
        { q: 'How many passes?', a: 'one' },
        { q: 'How much extra space?', a: 'O(1)' },
      ],
    })
  })

  it('classify suggests SLIDING WINDOW · M (banks contract §5.5)', () => {
    expect(fakeOutput('classify', REQ.classify)).toEqual({
      title: 'Fake classified item',
      pattern: 'SLIDING WINDOW',
      difficulty: 'M',
      source: 'Text',
      note: '[fake:classify] Suggested SLIDING WINDOW · M for new item.',
      approaches: [
        { name: 'Brute force', pattern: null, complexity: 'O(n²)' },
        { name: 'Sliding window', pattern: 'SLIDING WINDOW', complexity: 'O(n)', libraryKey: 'slidingWindow', best: true },
      ],
    })
    expect(fakeOutput('classify', { ticket: { id: 'mine-x', title: 'x', track: 'dsa' }, context: { input: 'x' } }).note)
      .toBe('[fake:classify] Suggested SLIDING WINDOW · M for mine-x.')
  })

  it.each([...JOB_NAMES])('%s error variant throws "fake <job> unavailable"', job => {
    let err: unknown
    try { fakeOutput(job, REQ[job] as never, 'error') } catch (e) { err = e }
    expect(err).toBeInstanceOf(AiJobError)
    expect((err as AiJobError).code).toBe('claude_failed')
    expect((err as AiJobError).message).toBe(`fake ${job} unavailable`)
  })

  it('the __fail_classify__ input fails classify with the banks message', () => {
    expect(() => fakeOutput('classify', { ticket: null, context: { input: 'x __fail_classify__ y' } })).toThrow('fake classify failure')
  })

  it('an unknown variant means default', () => {
    expect(fakeOutput('hint', REQ.hint, 'sparkly')).toEqual(fakeOutput('hint', REQ.hint))
  })
})

describe('readFakeHooks (common rules 2 and 7; Review Focus #4)', () => {
  it('defaults with no storage or empty storage', () => {
    expect(readFakeHooks('hint', null)).toEqual({ variant: 'default', fail: null, delayMs: 0 })
    expect(readFakeHooks('hint', store({}))).toEqual({ variant: 'default', fail: null, delayMs: 0 })
  })
  it('reads the per-job variant key', () => {
    expect(fakeVariantKey('grade')).toBe('dojo:fake-ai-grade')
    expect(readFakeHooks('grade', store({ 'dojo:fake-ai-grade': 'low' })).variant).toBe('low')
    expect(readFakeHooks('hint', store({ 'dojo:fake-ai-grade': 'low' })).variant).toBe('default')
  })
  it('parses the fail hook: job or *, optional code, default claude_failed', () => {
    expect(readFakeHooks('hint', store({ 'dojo-ai-fake-fail': 'hint' })).fail).toBe('claude_failed')
    expect(readFakeHooks('picture', store({ 'dojo-ai-fake-fail': 'picture:invalid_output' })).fail).toBe('invalid_output')
    expect(readFakeHooks('grade', store({ 'dojo-ai-fake-fail': '*:timeout' })).fail).toBe('timeout')
    expect(readFakeHooks('grade', store({ 'dojo-ai-fake-fail': 'hint' })).fail).toBeNull()
    expect(readFakeHooks('hint', store({ 'dojo-ai-fake-fail': 'hint:bogus' })).fail).toBe('claude_failed')
    expect(readFakeHooks('hint', store({ 'dojo-ai-fake-fail': 'nope' })).fail).toBeNull()
  })
  it('parses the delay hook and ignores junk', () => {
    expect(readFakeHooks('hint', store({ 'dojo-ai-fake-delay-ms': '1500' })).delayMs).toBe(1500)
    expect(readFakeHooks('hint', store({ 'dojo-ai-fake-delay-ms': '-5' })).delayMs).toBe(0)
    expect(readFakeHooks('hint', store({ 'dojo-ai-fake-delay-ms': 'soon' })).delayMs).toBe(0)
  })
  it('survives a storage that throws (private mode)', () => {
    const boom = { getItem: () => { throw new Error('SecurityError') } }
    expect(readFakeHooks('hint', boom)).toEqual({ variant: 'default', fail: null, delayMs: 0 })
  })
  it('reads window.localStorage when no storage is passed', () => {
    localStorage.setItem('dojo:fake-ai-grade', 'error')
    expect(readFakeHooks('grade').variant).toBe('error')
  })
})

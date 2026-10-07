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
  suggest_slide: {
    ticket: null,
    context: {
      count: 2,
      tickets: [
        { id: 'a', title: 'A', track: 'ai', estMin: 50, slidCount: 0 },
        { id: 'b', title: 'B', track: 'ai', estMin: 50, slidCount: 1 },
        { id: 'c', title: 'C', track: 'interview', estMin: 30, slidCount: 0 },
      ],
    },
  },
  classify: { ticket: null, context: { input: 'https://leetcode.com/problems/maximum-number-of-robots-within-budget/' } },
  brief: { ticket: T, context: { kind: 'task', forge: false, estMin: 50, sprint: 1 } },
  check: { ticket: T, context: { questions: [{ id: 'q1', kind: 'open', q: 'x', answer: 'number of islands' }] } },
  review_sprint: { ticket: null, context: { stats: { sprint: 1, planned: 2, done: 1, focusDays: [], longestStreak: 0, gaps: [], slipped: [], redoPassRate: null, checkPassRate: null } } },
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

  it('interview turns and the final grade', () => {
    expect(fakeOutput('interview', REQ.interview)).toEqual({
      say: '[fake:interview] Turn 0 for d-ratelimit: which trade-off did you choose, and why?', done: false,
    })
    const final = fakeOutput('interview', { ...REQ.interview, context: { ...REQ.interview.context, turn: 10, final: true } })
    expect(final).toEqual({
      done: true,
      score: 15,
      perItem: [
        { item: 'Requirements and numbers', points: 4, note: '[fake:interview] d-ratelimit' },
        { item: 'API and data model', points: 2, note: '[fake:interview] d-ratelimit' },
        { item: 'High-level design that meets the numbers', points: 3, note: '[fake:interview] d-ratelimit' },
        { item: 'Two deep dives with real trade-offs', points: 4, note: '[fake:interview] d-ratelimit' },
        { item: 'Failure modes and operations', points: 2, note: '[fake:interview] d-ratelimit' },
      ],
      oneThingToStudy: '[fake:interview] d-ratelimit',
      deepDives: [2, 1, 2, 1],
      lenses: { load: 2, data: 1, consistency: 1, failure: 1, latency: 1, cost: 0, evolution: 1 },
    })
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

  it('suggest_slide slides the first count tickets and keeps the rest', () => {
    expect(fakeOutput('suggest_slide', REQ.suggest_slide)).toEqual({
      slide: [
        { id: 'a', reason: '[fake:suggest_slide] Slide a: fewest slides so far.' },
        { id: 'b', reason: '[fake:suggest_slide] Slide b: fewest slides so far.' },
      ],
      keep: [{ id: 'c', reason: '[fake:suggest_slide] Keep c: fits this sprint.' }],
    })
    const ctx = REQ.suggest_slide.context
    expect(fakeOutput('suggest_slide', { ticket: null, context: { ...ctx, count: 9 } }).keep).toEqual([])
    expect(fakeOutput('suggest_slide', { ticket: null, context: { ...ctx, count: -1 } }).slide).toEqual([])
    expect(fakeOutput('suggest_slide', { ticket: null, context: { ...ctx, count: Number.NaN } }).slide).toEqual([])
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

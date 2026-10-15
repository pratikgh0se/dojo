import { describe, expect, it } from 'vitest'
import { fakeOutput } from '../../src/ai/fake'
import { SESSION_GRADE_MAX_WORDS, wordCount } from '../../src/ai/guardrails'
import { INTERVIEW_FINAL_EXAMPLE, INTERVIEW_FINAL_SCHEMA } from '../../src/ai/prompts'
import { repairOutput } from '../../src/ai/repair'
import { NOTE_EVIDENCE_IDS } from '../../src/ai/types'
import { validateOutput } from '../../src/ai/validate'
import { NOTE_SECTIONS } from '../../src/rules/designNotes'

// F3 spec: perItem gains feedback (<= 60 words) and evidence (<= 3 {source, target}); the final gains missed (<= 3 {topic <= 5, question <= 25, answer <= 60 words}).
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ')
const req = { context: { sessionGrade: true } }
const ITEMS = ['Requirements and numbers', 'API and data model', 'High-level design that meets the numbers', 'Two deep dives with real trade-offs', 'Failure modes and operations']
const final = (patch: Record<string, unknown> = {}, item: Record<string, unknown> = {}) => ({
  done: true, score: 15,
  perItem: ITEMS.map((x, i) => ({ item: x, points: [4, 2, 3, 4, 2][i], note: 'n', ...(i === 0 ? item : {}) })),
  oneThingToStudy: 'x', deepDives: [2, 1, 1, 0],
  lenses: { load: 1, data: 1, consistency: 1, failure: 1, latency: 1, cost: 1, evolution: 1 }, ...patch,
})
const fix = (o: unknown) => repairOutput('grade', req, o) as { perItem: { feedback?: string; evidence?: { source: string; target: string }[] }[]; missed?: { topic: string; question: string; answer: string }[] }

describe('F3 grade schema: repair', () => {
  it('trims an oversize feedback to 60 words and keeps a good one as written', () => {
    const f = fix(final({}, { feedback: words(90) }))
    expect(wordCount(f.perItem[0].feedback!)).toBe(60)
    expect(fix(final({}, { feedback: 'Short and concrete.' })).perItem[0].feedback).toBe('Short and concrete.')
  })
  it('a missing or non-string feedback is absent', () => {
    expect(fix(final()).perItem[0].feedback).toBeUndefined()
    expect(fix(final({}, { feedback: 7 })).perItem[0].feedback).toBeUndefined()
    expect(fix(final({}, { feedback: '  ' })).perItem[0].feedback).toBeUndefined()
  })
  it('evidence: unknown notes sections dropped, at most 3 kept, bad shapes dropped, targets trimmed', () => {
    const ev = [
      { source: 'notes', target: 'api' }, { source: 'notes', target: 'nope' }, { source: 'diagram', target: 'Queue' },
      { source: 'web', target: 'x' }, 'str', { source: 'diagram', target: '' }, { source: 'notes', target: 'tradeoffs' }, { source: 'notes', target: 'open' },
    ]
    expect(fix(final({}, { evidence: ev })).perItem[0].evidence).toEqual([
      { source: 'notes', target: 'api' }, { source: 'diagram', target: 'Queue' }, { source: 'notes', target: 'tradeoffs' },
    ])
    const long = fix(final({}, { evidence: [{ source: 'diagram', target: 'x'.repeat(200) }] })).perItem[0].evidence!
    expect(long[0].target.length).toBeLessThanOrEqual(80)
  })
  it('a notes target may name the section by its title or any case', () => {
    const ev = [{ source: 'notes', target: 'Data model' }, { source: 'notes', target: 'Open questions' }, { source: 'notes', target: ' Trade-offs ' }]
    expect(fix(final({}, { evidence: ev })).perItem[0].evidence!.map(e => e.target)).toEqual(['data-model', 'open', 'tradeoffs'])
  })
  it('evidence with nothing usable is absent', () => {
    expect(fix(final({}, { evidence: [{ source: 'notes', target: 'zzz' }] })).perItem[0].evidence).toBeUndefined()
    expect(fix(final({}, { evidence: 'api' })).perItem[0].evidence).toBeUndefined()
  })
  it('missed: capped at 3, fields trimmed to 5 / 25 / 60 words, incomplete entries dropped, [] is absent', () => {
    const m = (t: string) => ({ topic: t, question: words(40), answer: words(100) })
    const f = fix(final({ missed: [m('one two three four five six seven'), m('b'), { topic: 'no answer', question: 'q' }, m('c'), m('d')] }))
    expect(f.missed).toHaveLength(3)
    expect(wordCount(f.missed![0].topic)).toBe(5)
    expect(wordCount(f.missed![0].question)).toBe(25)
    expect(wordCount(f.missed![0].answer)).toBe(60)
    expect(fix(final({ missed: [] })).missed).toBeUndefined()
    expect(fix(final({ missed: 'x' })).missed).toBeUndefined()
  })
  it('a final from before F3 is unchanged in shape and still valid', () => {
    const f = fix(final())
    expect(f.missed).toBeUndefined()
    expect(validateOutput('grade', f)).toEqual([])
  })
})

describe('F3 grade schema: validate', () => {
  it('accepts the new fields', () => {
    const ok = final({ missed: [{ topic: 'partition key', question: 'q?', answer: 'a' }] }, { feedback: 'Fine.', evidence: [{ source: 'notes', target: 'api' }, { source: 'diagram', target: 'Queue' }] })
    expect(validateOutput('grade', ok)).toEqual([])
  })
  it.each([
    ['feedback over 60 words', { feedback: words(61) }],
    ['feedback not a string', { feedback: 5 }],
    ['evidence over 3', { evidence: [1, 2, 3, 4].map(() => ({ source: 'diagram', target: 'x' })) }],
    ['evidence with an unknown notes section', { evidence: [{ source: 'notes', target: 'nope' }] }],
    ['evidence with a bad source', { evidence: [{ source: 'web', target: 'x' }] }],
  ])('rejects %s', (_n, item) => {
    expect(validateOutput('grade', final({}, item))).not.toEqual([])
  })
  it.each([
    ['more than 3 missed', { missed: Array.from({ length: 4 }, () => ({ topic: 't', question: 'q', answer: 'a' })) }],
    ['a topic over 5 words', { missed: [{ topic: words(6), question: 'q', answer: 'a' }] }],
    ['a question over 25 words', { missed: [{ topic: 't', question: words(26), answer: 'a' }] }],
    ['an answer over 60 words', { missed: [{ topic: 't', question: 'q', answer: words(61) }] }],
    ['an entry without an answer', { missed: [{ topic: 't', question: 'q' }] }],
  ])('rejects %s', (_n, patch) => {
    expect(validateOutput('grade', final(patch))).not.toEqual([])
  })
})

describe('F3 grade schema: prompt, example and ids', () => {
  it('the schema names the new fields and the example uses them and validates', () => {
    for (const k of ['feedback', 'evidence', 'missed']) expect(INTERVIEW_FINAL_SCHEMA).toContain(`"${k}"`)
    expect(INTERVIEW_FINAL_EXAMPLE.perItem.every(p => !!p.feedback && (p.evidence?.length ?? 0) > 0)).toBe(true)
    expect(INTERVIEW_FINAL_EXAMPLE.missed?.length).toBe(3)
    expect(validateOutput('grade', INTERVIEW_FINAL_EXAMPLE)).toEqual([])
  })
  it('the word budget has room for five 60-word paragraphs and three weak spots', () => {
    expect(SESSION_GRADE_MAX_WORDS).toBe(1000)
    expect(INTERVIEW_FINAL_SCHEMA).toContain('1000 words')
    const all = [
      ...INTERVIEW_FINAL_EXAMPLE.perItem.flatMap(p => [p.note, p.feedback ?? '']), INTERVIEW_FINAL_EXAMPLE.oneThingToStudy,
      ...(INTERVIEW_FINAL_EXAMPLE.inconsistencies ?? []), ...(INTERVIEW_FINAL_EXAMPLE.stronger ?? []),
      ...(INTERVIEW_FINAL_EXAMPLE.missed ?? []).flatMap(m => [m.topic, m.question, m.answer]),
    ]
    expect(wordCount(all.join(' '))).toBeLessThanOrEqual(SESSION_GRADE_MAX_WORDS)
  })
  it('the note section ids the AI may cite are the app notes sections', () => {
    expect([...NOTE_EVIDENCE_IDS]).toEqual(NOTE_SECTIONS.map(s => s.id))
  })
})

describe('F3 grade schema: the fake', () => {
  const body = 'DIAGRAM\nnodes:\n- Queue [queue]\n- Render engine [service] - draws tiles\n- layers [table] (columns: id, blob_ref)\nlinks:\n- none\nframes:\n- none\n\nCANVAS NOTES\nnot written'
  const rq = (design?: string) => ({ ticket: { id: 'd-method', title: 'D', track: 'design' as const }, context: { sessionGrade: true, deepDives: ['a', 'b', 'c', 'd'], ...(design ? { design } : {}) } })
  const out = (design?: string) => fakeOutput('grade', rq(design) as never) as unknown as { perItem: { feedback: string; evidence: { source: string; target: string }[] }[]; missed: { topic: string; question: string; answer: string }[] }
  it('returns feedback, a notes and a diagram citation per item, and 3 missed; all valid', () => {
    const o = out(body)
    expect(o.perItem).toHaveLength(5)
    for (const p of o.perItem) {
      expect(p.feedback).toMatch(/^\[fake:partner\]/)
      expect(p.evidence.map(e => e.source)).toEqual(['notes', 'diagram'])
      expect(NOTE_EVIDENCE_IDS).toContain(p.evidence[0].target)
      expect(['Queue', 'Render engine', 'layers']).toContain(p.evidence[1].target)
    }
    expect(o.missed).toHaveLength(3)
    expect(validateOutput('grade', o)).toEqual([])
  })
  it('without a canvas label to cite the evidence is notes only', () => {
    const o = out('DIAGRAM\nnot written\n\nCANVAS NOTES\nnot written')
    for (const p of o.perItem) expect(p.evidence.map(e => e.source)).toEqual(['notes'])
    expect(validateOutput('grade', o)).toEqual([])
    expect(out().perItem[0].evidence.map(e => e.source)).toEqual(['notes'])
  })
  it('the interview final carries the same fields', () => {
    const o = fakeOutput('interview', { ticket: { id: 'd-x', title: 'x', track: 'design' }, context: { turn: 0, answers: [], deepDives: [], final: true } } as never) as unknown as { missed: unknown[] }
    expect(o.missed).toHaveLength(3)
  })
})

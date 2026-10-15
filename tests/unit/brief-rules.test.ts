import { describe, expect, it } from 'vitest'
import type { BriefOutput } from '../../src/ai/types'
import { isDraftable, isLearning, needsCheck, briefContext, isLearningCard, linkVerdict, minutesOf, sprintDraftQueue, stepUrls, toBrief } from '../../src/rules/brief'
import { mkTicket } from '../helpers/tickets'

const out = (over: Partial<BriefOutput> = {}): BriefOutput => ({
  goal: 'g', steps: [{ text: 'a', url: 'https://x.test/a' }, { text: 'b', url: 'https://x.test/a' }], minutes: 45, dayType: 'light', learn: ['l'],
  outcome: 'o', deliverable: { kind: 'answers', prompt: 'p' }, questions: [{ id: 'q1', kind: 'open', q: 'q' }], ...over,
})

describe('brief rules', () => {
  it('minutes come from the brief, else the per-kind default', () => {
    expect(minutesOf(mkTicket({ id: 'a', estMin: 30 }))).toBe(30)
    expect(minutesOf(mkTicket({ id: 'a', estMin: 30, brief: toBrief(out()) }))).toBe(45)
  })
  it('toBrief makes a draft from the model', () => {
    const b = toBrief(out())
    expect(b).toMatchObject({ status: 'draft', source: 'ai', goal: 'g' })
    expect('splitSuggestion' in b).toBe(false)
  })
  it('toBrief drops a stray split key from the model output (retired split suggestion)', () => {
    const b = toBrief({ ...out(), split: [{ title: 'part 1', minutes: 20 }] } as unknown as BriefOutput)
    expect('split' in b).toBe(false)
    expect(Object.keys(b).sort()).toEqual(['dayType', 'deliverable', 'goal', 'learn', 'minutes', 'outcome', 'questions', 'source', 'status', 'steps'])
  })
  it('the draft queue is the unfinished, unbriefed cards of the sprint in plan order', () => {
    const ts = [
      mkTicket({ id: 'c', order: 3 }), mkTicket({ id: 'a', order: 1 }), mkTicket({ id: 'done', order: 2, status: 'done' }),
      mkTicket({ id: 'has', order: 4, brief: toBrief(out()) }), mkTicket({ id: 'other', sprint: 2 }), mkTicket({ id: 'arch', archived: true }),
    ]
    expect(sprintDraftQueue(ts, 1).map(t => t.id)).toEqual(['a', 'c'])
  })
  it('needsCheck: a watch or read card with a brief always needs it, even with its questions removed; others need questions', () => {
    const noQ = toBrief(out({ deliverable: { kind: 'code', prompt: 'p' }, questions: [] }))
    expect(needsCheck(mkTicket({ id: 'w', kind: 'watch', brief: noQ }))).toBe(true)
    expect(needsCheck(mkTicket({ id: 'r', kind: 'read', brief: noQ }))).toBe(true)
    expect(needsCheck(mkTicket({ id: 'w', kind: 'watch' }))).toBe(false)
    expect(needsCheck(mkTicket({ id: 'w', kind: 'watch', status: 'done', brief: noQ }))).toBe(false)
    expect(needsCheck(mkTicket({ id: 't', kind: 'task', brief: noQ }))).toBe(false)
    expect(needsCheck(mkTicket({ id: 't', kind: 'task', brief: toBrief(out()) }))).toBe(true)
  })
  it('learning cards and link lists', () => {
    expect(isLearningCard(mkTicket({ id: 'a', brief: toBrief(out()) }))).toBe(true)
    expect(isLearningCard(mkTicket({ id: 'a', brief: toBrief(out({ deliverable: { kind: 'code', prompt: 'p' } })) }))).toBe(false)
    expect(stepUrls(toBrief(out()))).toEqual(['https://x.test/a'])
  })
  it('isLearning is watch or read; isDraftable is problem, design or task', () => {
    const t = (over: Parameters<typeof mkTicket>[0]) => mkTicket(over)
    expect(isLearning(t({ id: 'a', kind: 'watch' }))).toBe(true)
    expect(isLearning(t({ id: 'a', kind: 'read' }))).toBe(true)
    for (const kind of ['task', 'problem', 'design', 'build', 'writeup', 'ritual', 'stage'] as const) expect(isLearning(t({ id: 'a', kind })), kind).toBe(false)
    for (const kind of ['problem', 'design', 'task'] as const) expect(isDraftable(t({ id: 'a', kind })), kind).toBe(true)
    for (const kind of ['watch', 'read', 'build', 'writeup', 'ritual', 'stage'] as const) expect(isDraftable(t({ id: 'a', kind })), kind).toBe(false)
  })
  it('the AI context carries kind, learning and the estimate', () => {
    expect(briefContext(mkTicket({ id: 's', kind: 'watch', estMin: 45 }))).toEqual({ kind: 'watch', learning: true, estMin: 45 })
    expect(briefContext(mkTicket({ id: 's', kind: 'problem', estMin: 30 }))).toEqual({ kind: 'problem', learning: false, estMin: 30 })
  })
  it('needsCheck follows a watch or read ticket that has a brief', () => {
    const noQ = toBrief(out({ deliverable: { kind: 'code', prompt: 'p' }, questions: [] }))
    expect(needsCheck(mkTicket({ id: 'a', kind: 'read', brief: noQ }))).toBe(true)
    expect(needsCheck(mkTicket({ id: 'a', kind: 'build', brief: noQ }))).toBe(false)
  })
})

describe('linkVerdict (UAT cu-4 P3-4)', () => {
  it('ok is ok; a host that refuses the check is unverified; the rest that failed is broken', () => {
    expect(linkVerdict({ ok: true, status: 200 })).toBe('ok')
    expect(linkVerdict({ ok: true, status: 301 })).toBe('ok')
    for (const status of [401, 403, 429, 999]) expect(linkVerdict({ ok: false, status })).toBe('unverified')
    for (const status of [0, 400, 404, 410, 500, 503]) expect(linkVerdict({ ok: false, status })).toBe('broken')
  })
})

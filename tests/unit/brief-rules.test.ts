import { describe, expect, it } from 'vitest'
import type { BriefOutput } from '../../src/ai/types'
import { deliverableOf, isTeachback, isLearning, needsCheck, briefContext, briefStrings, enforceForge, forgeCodeProblem, hasCode, stripCode, isContainer, isForge, isLearningCard, linkVerdict, minutesOf, sprintDraftQueue, stepUrls, toBrief } from '../../src/rules/brief'
import { mkTicket } from '../helpers/tickets'

const out = (over: Partial<BriefOutput> = {}): BriefOutput => ({
  goal: 'g', steps: [{ text: 'a', url: 'https://x.test/a' }, { text: 'b', url: 'https://x.test/a' }], minutes: 45, dayType: 'light', learn: ['l'],
  outcome: 'o', deliverable: { kind: 'answers', prompt: 'p' }, questions: [{ id: 'q1', kind: 'open', q: 'q' }], ...over,
})

describe('brief rules', () => {
  it('forge means AI track and not a watch or read card (Addendum 1 Q10)', () => {
    expect(isForge(mkTicket({ id: 'a', track: 'ai', kind: 'task' }))).toBe(true)
    expect(isForge(mkTicket({ id: 'b', track: 'ai', kind: 'stage' }))).toBe(true)
    expect(isForge(mkTicket({ id: 'w', track: 'ai', kind: 'watch' }))).toBe(false)
    expect(isForge(mkTicket({ id: 'r', track: 'ai', kind: 'read' }))).toBe(false)
    expect(isForge(mkTicket({ id: 'c', track: 'interview', kind: 'problem' }))).toBe(false)
  })
  it('minutes come from the brief, else the per-kind default', () => {
    expect(minutesOf(mkTicket({ id: 'a', estMin: 30 }))).toBe(30)
    expect(minutesOf(mkTicket({ id: 'a', estMin: 30, brief: toBrief(out()) }))).toBe(45)
  })
  it('toBrief makes a draft from the model and keeps the split proposal', () => {
    const b = toBrief(out({ split: [{ title: 'one', minutes: 60 }, { title: 'two', minutes: 60 }] }))
    expect(b).toMatchObject({ status: 'draft', source: 'ai', goal: 'g', splitSuggestion: [{ title: 'one', minutes: 60 }, { title: 'two', minutes: 60 }] })
    expect('split' in b).toBe(false)
    expect('splitSuggestion' in toBrief(out())).toBe(false)
  })
  it('enforceForge makes a forge deliverable the canonical typed-by-hand prompt, drops questions, scrubs every text field', () => {
    const wild = out({
      goal: 'Build it:\n```py\nprint(1)\n```', outcome: 'Run `make test` and see green', learn: ['loops `for x`', '```only code```'],
      steps: [{ text: 'Do this:\n```py\nprint(1)\n```\nthen that' }, { text: '```x```' }, { text: 'tilde\n~~~\nsecret()\n~~~\nafter' }],
      deliverable: { kind: 'note', prompt: 'Explain it, with a snippet' }, split: [{ title: '`a` one', minutes: 60 }, { title: 'two', minutes: 60 }],
    })
    const f = enforceForge(wild, true)
    expect(f.deliverable).toEqual({ kind: 'code', prompt: 'Paste your code, typed by hand' })
    expect(f.questions).toEqual([])
    for (const t of briefStrings(f)) expect(hasCode(t), t).toBe(false)
    expect(f.steps[0].text).toContain('then that')
    expect(f.steps[1].text).toBe('Work through the reference by hand')
    expect(f.steps[2].text).toBe('tilde\nafter')
    expect(f.outcome).toBe('Run  and see green')
    expect(f.learn).toEqual(['loops'])
    expect(f.split?.[0].title).toBe('one')
  })
  it('an unmatched opening fence runs to the end of the string; ~~~ and long fences close only on their own kind', () => {
    expect(stripCode('keep\n```py\nnever closed\nmore')).toBe('keep')
    expect(stripCode('a\n~~~\nx\n~~~\nb')).toBe('a\nb')
    expect(stripCode('a\n````\n```\nstill code\n````\nb')).toBe('a\nb')
    expect(stripCode('a\n```\nx\n~~~\nstill code')).toBe('a')
    expect(stripCode('an `unclosed tick')).toBe('an')
    expect(stripCode('plain text')).toBe('plain text')
  })
  it('hasCode and forgeCodeProblem catch fences, tildes and any backtick in any field', () => {
    for (const t of ['x\n```\ny', '~~~\ny', 'use `ls`', 'stray ` tick']) expect(hasCode(t), t).toBe(true)
    expect(hasCode('no code here')).toBe(false)
    expect(forgeCodeProblem(out())).toBeNull()
    expect(forgeCodeProblem(out({ learn: ['run `x`'] }))).toContain('must not contain code')
    expect(forgeCodeProblem(out({ questions: [{ id: 'q1', kind: 'open', q: 'q', keyIdeas: ['```a```'] }] }))).not.toBeNull()
    expect(forgeCodeProblem(out({ steps: [{ text: 'ok', url: 'https://x.test/`a`' }] }))).not.toBeNull()
  })
  it('hasCode catches lines that look like code', () => {
    for (const t of ['def add(a, b):', 'class Node:', 'class Node(Base):', 'import os', 'import numpy as np', 'func main() {', 'for (i = 0; i < n; i++)', 'return f(x)', 'return x;', 'return a + b', 'if (ok) {']) {
      expect(hasCode(t), t).toBe(true)
    }
  })
  it('hasCode leaves plain prose alone, including semicolons, lists and words that start like keywords', () => {
    for (const t of [
      'Watch the first 20 minutes of the lecture and pause at each derivative.',
      'Read the attention section; note the three matrices;',
      'Trade-offs: latency vs throughput; memory vs speed;',
      '1. Read the attention paper (section 3);\n2. Note the three matrices;\n3. Write two sentences (no code);',
      '- Watch the video (20 min);\n  - note the loss curve (see 4:10);\n    - and the learning rate (a = 0.1);',
      '* top level\n    * nested marker, four spaces in\n    1. numbered and nested (x = y);',
      'Understand when a heap beats a sorted array: both give O(log n) inserts;',
      'Key relation to remember: throughput = concurrency / latency;',
      'Know the softmax formula p(i) = exp(z_i) / sum(exp(z));',
      '    Then repeat the exercise with a larger batch size.',
      'return to the notes', 'Return to your notes and write three sentences.', 'import the dataset', 'class imbalance',
      'class imbalance (see the paper) matters for this run',
      'Open the repo. Type the backward pass yourself (no copy and paste).',
      'Spend 45 minutes: 25 on the reading, 20 on the exercise, then stop',
      'The function f maps x to x squared - sketch it on paper.\nThen compare with the video.',
    ]) expect(hasCode(t), t).toBe(false)
    expect(forgeCodeProblem(out({ steps: [{ text: 'ok' }, { text: 'return x;' }] }))).toBe('a forge brief must not contain code (a fence, backticks or code-looking lines)')
    expect(forgeCodeProblem(out({ outcome: 'You can explain the chain rule.' }))).toBeNull()
  })
  it('enforceForge leaves non-forge briefs alone', () => {
    const plain = out()
    expect(enforceForge(plain, false)).toBe(plain)
  })
  it('the draft queue is the unfinished, unbriefed, non-container cards of the sprint in plan order', () => {
    const ts = [
      mkTicket({ id: 'c', order: 3 }), mkTicket({ id: 'a', order: 1 }), mkTicket({ id: 'done', order: 2, status: 'done' }),
      mkTicket({ id: 'has', order: 4, brief: toBrief(out()) }), mkTicket({ id: 'other', sprint: 2 }), mkTicket({ id: 'arch', archived: true }),
      mkTicket({ id: 'box', order: 5, children: ['x'] }),
      // ruling 25 R3: a part has no brief of its own (it shows its parent's); a split parent is never drafted either
      mkTicket({ id: 'x', order: 5.5, origin: 'box', childOf: 'box' }), mkTicket({ id: 'y', order: 5.6, origin: 'box', childOf: 'box' }),
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
  it('containers, learning cards and link lists', () => {
    expect(isContainer(mkTicket({ id: 'a', children: ['x'] }))).toBe(true)
    expect(isContainer(mkTicket({ id: 'a' }))).toBe(false)
    expect(isLearningCard(mkTicket({ id: 'a', brief: toBrief(out()) }))).toBe(true)
    expect(isLearningCard(mkTicket({ id: 'a', brief: toBrief(out({ deliverable: { kind: 'code', prompt: 'p' } })) }))).toBe(false)
    expect(stepUrls(toBrief(out()))).toEqual(['https://x.test/a'])
  })
  it('isLearning: watch, read, and a stage whose session is watch; forge build and rebuild stages are not', () => {
    const t = (over: Parameters<typeof mkTicket>[0]) => mkTicket(over)
    expect(isLearning(t({ id: 'a', kind: 'watch' }))).toBe(true)
    expect(isLearning(t({ id: 'a', kind: 'read' }))).toBe(true)
    expect(isLearning(t({ id: 'a', kind: 'stage', session: 'watch' }))).toBe(true)
    for (const s of ['rebuild', 'build', 'teachback'] as const) expect(isLearning(t({ id: 'a', kind: 'stage', session: s })), s).toBe(false)
    expect(isLearning(t({ id: 'a', kind: 'task' }))).toBe(false)
    expect(isForge(t({ id: 'a', track: 'ai', kind: 'stage', session: 'watch' }))).toBe(false)
    expect(isForge(t({ id: 'a', track: 'ai', kind: 'stage', session: 'build' }))).toBe(true)
    const noQ = toBrief(out({ deliverable: { kind: 'code', prompt: 'p' }, questions: [] }))
    expect(needsCheck(t({ id: 'a', kind: 'stage', session: 'watch', brief: noQ }))).toBe(true)
    expect(needsCheck(t({ id: 'a', kind: 'stage', session: 'build', brief: noQ }))).toBe(false)
  })
  it('the AI context carries kind, forge, estimate, sprint, session and stage', () => {
    expect(briefContext(mkTicket({ id: 's', kind: 'stage', session: 'watch', stage: 2, sprint: 5, estMin: 50 }))).toEqual({ kind: 'stage', forge: false, learning: true, estMin: 50, sprint: 5, session: 'watch', stage: 2 })
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

describe('teach-back cards (UAT cu-5 P2-2)', () => {
  const tb = (over: Parameters<typeof mkTicket>[0]) => mkTicket({ track: 'ai', kind: 'stage', session: 'teachback', ...over })
  it('a teach-back is a stage ticket whose session is teachback; it is still forge work, so its brief carries no code', () => {
    expect(isTeachback(tb({ id: 'a' }))).toBe(true)
    expect(isTeachback(mkTicket({ id: 'b', track: 'ai', kind: 'stage', session: 'build' }))).toBe(false)
    expect(isTeachback(mkTicket({ id: 'c', track: 'ai', kind: 'task' }))).toBe(false)
    expect(isForge(tb({ id: 'a' }))).toBe(true)
    expect(briefContext(tb({ id: 'a' })).teachback).toBe(true)
    expect('teachback' in briefContext(mkTicket({ id: 'b', track: 'ai', kind: 'stage', session: 'build' }))).toBe(false)
  })
  it('enforceForge gives a teach-back the explanation deliverable and every other forge card the typed-by-hand one', () => {
    const wild = out({ deliverable: { kind: 'code', prompt: 'Paste your code' } })
    expect(enforceForge(wild, true, true).deliverable).toEqual({ kind: 'explanation', prompt: 'Explain it in your own words' })
    expect(enforceForge(wild, true, true).questions).toEqual([])
    expect(enforceForge(wild, true).deliverable).toEqual({ kind: 'code', prompt: 'Paste your code, typed by hand' })
    expect(enforceForge(wild, false, true)).toBe(wild)
  })
  it('deliverableOf reads an old teach-back draft (the forge code prompt) as an explanation and leaves anything else alone', () => {
    const brief = (deliverable: BriefOutput['deliverable']) => toBrief(out({ deliverable }))
    const forgeCode = brief({ kind: 'code', prompt: 'Paste your code, typed by hand' })
    expect(deliverableOf(tb({ id: 'a', brief: forgeCode }))).toEqual({ kind: 'explanation', prompt: 'Explain it in your own words' })
    expect(deliverableOf(mkTicket({ id: 'b', track: 'ai', kind: 'stage', session: 'build', brief: forgeCode }))).toEqual(forgeCode.deliverable)
    const edited = brief({ kind: 'note', prompt: 'Write it up' })
    expect(deliverableOf(tb({ id: 'c', brief: edited }))).toEqual(edited.deliverable)
    expect(deliverableOf(tb({ id: 'd', brief: forgeCode }), edited)).toEqual(edited.deliverable) // a part passes its parent's brief
    expect(deliverableOf(tb({ id: 'e' }))).toBeNull()
  })
})

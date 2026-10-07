import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FAKE_FAIL_KEY } from '../../src/ai/fake'
import { deliverableFeedback, submitCheck, submitDeliverable } from '../../src/data/checkActions'
import { draftBrief } from '../../src/data/briefActions'
import { totalXp } from '../../src/rules/xp'
import { freshDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'

const NOW = new Date(2026, 9, 6, 12, 0).getTime()
const failHook = (v: string | null) => { if (v === null) localStorage.removeItem(FAKE_FAIL_KEY); else localStorage.setItem(FAKE_FAIL_KEY, v) }
beforeEach(() => failHook(null))
afterEach(() => failHook(null))

async function learning() {
  const d = freshDb()
  await d.tickets.put(mkTicket({ id: 'w1', kind: 'watch', track: 'interview', title: 'Hash maps' }))
  await draftBrief(d, 'w1', NOW)
  return d
}
const good = [{ id: 'q1', answer: 'I can explain hash maps now' }, { id: 'q2', choice: 0 }]
const bad = [{ id: 'q1', answer: 'no idea' }, { id: 'q2', choice: 0 }]

describe('submitCheck', () => {
  it('BR-05: a pass finishes the card with XP through netOf, keeps the attempt and one event', async () => {
    const d = await learning()
    const r = await submitCheck(d, 'w1', good, NOW)
    expect(r).toMatchObject({ ok: true, passed: true, xpDelta: 10 })
    expect(await d.tickets.get('w1')).toMatchObject({ status: 'done', xp: 10, doneAt: NOW })
    expect(totalXp(await d.tickets.toArray())).toBe(10)
    const rows = await d.checkAttempts.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ ticketId: 'w1', passed: true, at: NOW, answers: good })
    expect(rows[0].feedback.map(f => f.verdict)).toEqual(['pass', 'pass'])
    expect(await d.redos.count()).toBe(0)
    expect((await d.events.toArray()).filter(e => e.t === 'check')).toEqual([{ seq: expect.any(Number), t: 'check', id: 'w1', at: NOW, passed: true }])
  })
  it('BR-06: a fail leaves the card open, keeps the attempt with corrections and schedules exactly one redo in 3 days', async () => {
    const d = await learning()
    const r = await submitCheck(d, 'w1', bad, NOW)
    expect(r).toMatchObject({ ok: true, passed: false, xpDelta: 0 })
    expect((await d.tickets.get('w1'))!.status).toBe('todo')
    const rows = await d.checkAttempts.toArray()
    expect(rows[0]).toMatchObject({ passed: false, answers: bad })
    expect(rows[0].feedback[0]).toEqual({ id: 'q1', verdict: 'fail', correction: 'Mention Hash maps', pointer: 'Step 1' })
    const redos = await d.redos.toArray()
    expect(redos).toHaveLength(1)
    expect(redos[0]).toMatchObject({ ticketId: 'w1', due: '2026-10-09', source: 'check_failed', stage: 0 })
  })
  it('a second failure moves the same redo out again instead of adding one; a later pass closes it', async () => {
    const d = await learning()
    await submitCheck(d, 'w1', bad, NOW)
    await submitCheck(d, 'w1', bad, NOW + 86_400_000)
    const redos = await d.redos.toArray()
    expect(redos).toHaveLength(1)
    expect(redos[0].due).toBe('2026-10-10')
    expect(redos[0].passed).toEqual([false])
    await submitCheck(d, 'w1', good, NOW + 2 * 86_400_000)
    expect((await d.redos.toArray())[0]).toMatchObject({ closedAt: NOW + 2 * 86_400_000, passed: [false, true] })
    expect((await d.tickets.get('w1'))!.status).toBe('done')
    expect(await d.checkAttempts.count()).toBe(3)
  })
  it('a failed check pushes back any live redo, and a pass closes it', async () => {
    const d = await learning()
    await d.redos.add({ id: 'gu', ticketId: 'w1', source: 'gave_up', createdAt: NOW, stage: 1, due: NOW, passed: [true], helpCost: 4, refunded: 0 })
    await submitCheck(d, 'w1', bad, NOW)
    let all = await d.redos.toArray()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: 'gu', due: '2026-10-09', stage: 1, passed: [true, false] })
    await submitCheck(d, 'w1', good, NOW + 1000)
    all = await d.redos.toArray()
    expect(all[0]).toMatchObject({ closedAt: NOW + 1000, passed: [true, false, true] })
  })
  it('refuses unanswered questions and a card without a brief, changing nothing', async () => {
    const d = await learning()
    expect(await submitCheck(d, 'w1', [{ id: 'q1', answer: 'x' }], NOW)).toEqual({ ok: false, code: 'incomplete', error: 'Answer every question first' })
    await d.tickets.put(mkTicket({ id: 'plain' }))
    expect(await submitCheck(d, 'plain', good, NOW)).toMatchObject({ ok: false, code: 'no_brief' })
    expect(await d.checkAttempts.count()).toBe(0)
    expect(await d.redos.count()).toBe(0)
  })
  it('an AI failure stores nothing and does not finish the card', async () => {
    const d = await learning()
    failHook('check')
    expect(await submitCheck(d, 'w1', good, NOW)).toEqual({ ok: false, code: 'claude_failed', error: 'fake check unavailable' })
    expect(await d.checkAttempts.count()).toBe(0)
    expect((await d.tickets.get('w1'))!.status).toBe('todo')
  })
})

describe('submitDeliverable', () => {
  async function build() {
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'c1', kind: 'problem', track: 'interview', title: 'Two Sum', difficulty: 'E' }))
    await draftBrief(d, 'c1', NOW)
    return d
  }
  it('BR-07: stores the text on the ticket and finishes the card with base XP', async () => {
    const d = await build()
    const r = await submitDeliverable(d, 'c1', '  def two_sum(): ...  ', NOW)
    expect(r).toMatchObject({ ok: true, xpDelta: 5, deliverable: { kind: 'code', text: 'def two_sum(): ...', at: NOW } })
    expect(await d.tickets.get('c1')).toMatchObject({ status: 'done', xp: 5, deliverable: { text: 'def two_sum(): ...' } })
  })
  it('refuses empty text and a card without a brief', async () => {
    const d = await build()
    expect(await submitDeliverable(d, 'c1', '   ', NOW)).toEqual({ ok: false, error: 'Hand something in first' })
    await d.tickets.put(mkTicket({ id: 'plain' }))
    expect(await submitDeliverable(d, 'plain', 'x', NOW)).toEqual({ ok: false, error: 'This card has no brief yet' })
    expect((await d.tickets.get('c1'))!.status).toBe('todo')
  })
  it('the deliverable and the finished card land together: a refusal leaves the ticket untouched', async () => {
    const d = await build()
    await d.tickets.update('c1', { children: ['x'] }) // a container cannot be finished by hand
    expect(await submitDeliverable(d, 'c1', 'text', NOW)).toMatchObject({ ok: false })
    expect((await d.tickets.get('c1'))!.deliverable).toBeUndefined()
    expect((await d.tickets.get('c1'))!.status).toBe('todo')
  })
  it('optional feedback is stored with the deliverable and never finishes the card by itself', async () => {
    const d = await build()
    const f = await deliverableFeedback(d, 'c1', 'my attempt', NOW)
    expect(f).toEqual({ ok: true, feedback: ['[fake:grade] c1 runs, is hand-written, and is measured.'] })
    expect((await d.tickets.get('c1'))!.status).toBe('todo')
    await submitDeliverable(d, 'c1', 'my attempt', NOW, f.ok ? f.feedback : undefined)
    expect((await d.tickets.get('c1'))!.deliverable!.feedback).toHaveLength(1)
    failHook('grade')
    expect(await deliverableFeedback(d, 'c1', 'x', NOW)).toMatchObject({ ok: false, code: 'claude_failed' })
  })
})

describe('a teach-back card (UAT cu-5 P2-2)', () => {
  async function teachback() {
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'tb1', kind: 'stage', track: 'ai', session: 'teachback', stage: 0, title: 'Stage 00 · teach-back' }))
    await draftBrief(d, 'tb1', NOW)
    return d
  }
  it('is drafted with the explanation deliverable, not "Paste your code"', async () => {
    const d = await teachback()
    expect((await d.tickets.get('tb1'))!.brief!.deliverable).toEqual({ kind: 'explanation', prompt: 'Explain it in your own words' })
    // a build card of the same stage still hands in code typed by hand
    await d.tickets.put(mkTicket({ id: 'b1', kind: 'stage', track: 'ai', session: 'build', stage: 0, title: 'Stage 00 · build' }))
    await draftBrief(d, 'b1', NOW)
    expect((await d.tickets.get('b1'))!.brief!.deliverable).toEqual({ kind: 'code', prompt: 'Paste your code, typed by hand' })
  })
  it('"Get feedback" grades the prose as an explanation (no commit, diff or measurement), and the hand-in keeps the explanation kind', async () => {
    const d = await teachback()
    const f = await deliverableFeedback(d, 'tb1', 'The forward pass multiplies and adds; the backward pass reverses it.', NOW)
    expect(f).toEqual({ ok: true, feedback: ["[fake:grade] tb1: the explanation names the mechanism in the learner's own words."] })
    const r = await submitDeliverable(d, 'tb1', 'The forward pass multiplies and adds; the backward pass reverses it.', NOW, f.ok ? f.feedback : undefined)
    expect(r).toMatchObject({ ok: true, deliverable: { kind: 'explanation' } })
    expect((await d.tickets.get('tb1'))!.status).toBe('done')
  })
  it('a low grade names what to add, still as feedback only', async () => {
    const d = await teachback()
    localStorage.setItem('dojo:fake-ai-grade', 'low')
    try {
      expect(await deliverableFeedback(d, 'tb1', 'short', NOW)).toEqual({
        ok: true, feedback: ['[fake:grade] tb1: the explanation names the parts but not what each is for.', 'Missing: [fake:grade] a worked example'],
      })
    } finally { localStorage.removeItem('dojo:fake-ai-grade') }
  })
})

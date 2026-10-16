import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FAKE_FAIL_KEY } from '../../src/ai/fake'
import { submitCheck } from '../../src/data/checkActions'
import { seedBrief } from '../helpers/briefs'
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
  await seedBrief(d, 'w1')
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

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runJob } from '../../src/ai/client'
import { TRANSCRIPT_TEXT_MAX } from '../../src/ai/prompts'
import { setNow } from '../../src/lib/clock'
import type { PlanDesignRef } from '../../src/rules/designs'
import { askInterviewer, drawReference, freshDigest, gradeInterview } from '../../src/screens/designSession/designAi'
import { startDesignSession, saveNotes } from '../../src/data/designSessionActions'
import { emptyNotes } from '../../src/rules/designNotes'
import { seededDb } from '../helpers/db'
import { MAX_BODY_BYTES } from '../../server/helper.mjs'

const ITEM = {
  id: 'd-ratelimit', title: 'Distributed rate limiter and API gateway', difficulty: 'M',
  deepDives: ['a', 'b', 'c', 'd'], refs: [], tier: 2, tierName: 't', tierLabel: 't', tierShort: 't', order: 0,
} as unknown as PlanDesignRef
const T = new Date('2026-10-11T10:00:00+05:30').getTime()

// Pass-through mock: the real fake provider still answers; the mock only records the requests.
vi.mock('../../src/ai/client', async orig => {
  const m = await orig<typeof import('../../src/ai/client')>()
  return { ...m, runJob: vi.fn(m.runJob) }
})
const spy = vi.mocked(runJob)
beforeEach(() => spy.mockClear())

describe('design AI goes through callJob', () => {
  it('asks with the whole transcript, turn = answers so far, and logs one aiLog row', async () => {
    setNow(() => T)
    const d = await seededDb()
    const msgs = [{ from: 'interviewer' as const, text: 'Requirements?' }, { from: 'you' as const, text: '10k rps' }]
    const r = await askInterviewer(d, ITEM, msgs)
    expect(r.ok).toBe(true)
    const req = spy.mock.calls[0][1] as { context: { turn: number; answers: string[]; transcript: unknown } }
    expect(req.context.turn).toBe(1)
    // I2: the raw, unbounded answers never go alongside transcript - only the already-clipped transcript does.
    expect(req.context.answers).toEqual([])
    expect(req.context.transcript).toEqual(msgs)
    const rows = await d.aiLog.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ job: 'interview', ok: true, ticketId: 'd-ratelimit', at: T })
  })

  it('Review Focus 2: clips each transcript message before sending', async () => {
    const d = await seededDb()
    await askInterviewer(d, ITEM, [{ from: 'you', text: 'x'.repeat(TRANSCRIPT_TEXT_MAX + 50) }])
    const req = spy.mock.calls[0][1] as { context: { transcript: { text: string }[] } }
    expect(req.context.transcript[0].text.length).toBe(TRANSCRIPT_TEXT_MAX + 1)
  })

  it('I2: a 19-message, 5 KB/message request stays under the helper\'s MAX_BODY_BYTES', async () => {
    const d = await seededDb()
    const msgs = Array.from({ length: 19 }, (_, i) => ({
      from: (i % 2 ? 'you' : 'interviewer') as 'you' | 'interviewer',
      text: 'x'.repeat(5 * 1024),
    }))
    await askInterviewer(d, ITEM, msgs)
    const req = spy.mock.calls[0][1] as { ticket: unknown; context: unknown }
    expect(JSON.stringify(req).length).toBeLessThan(MAX_BODY_BYTES)
  })

  it('a 70-message conversation keeps only the last 20 messages, turn counts them all, and the body stays small', async () => {
    const d = await seededDb()
    const msgs = Array.from({ length: 70 }, (_, i) => ({ from: (i % 2 ? 'you' : 'interviewer') as 'you' | 'interviewer', text: 'x'.repeat(2000) }))
    await askInterviewer(d, ITEM, msgs)
    const req = spy.mock.calls[0][1] as { context: { turn: number; transcript: unknown[] } }
    expect(req.context.turn).toBe(35)
    expect(req.context.transcript).toHaveLength(20)
    expect(JSON.stringify(req).length).toBeLessThan(MAX_BODY_BYTES)
  })

  it('a failed turn reads without the word interview', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'interview')
    const d = await seededDb()
    const r = await askInterviewer(d, ITEM, [])
    localStorage.removeItem('dojo-ai-fake-fail')
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.error).toMatch(/unavailable/)
    expect(r.ok ? '' : r.error).not.toMatch(/interview/i)
  })

  it('final grade and reference diagram log their jobs too', async () => {
    const d = await seededDb()
    expect((await gradeInterview(d, ITEM, [])).ok).toBe(true)
    expect((await drawReference(d, ITEM)).ok).toBe(true)
    expect((await d.aiLog.toArray()).map(r => r.job)).toEqual(['grade', 'diagram'])
  })

  it('a turn carries the clipped design digest; a Hint carries hint:true and logs job interview', async () => {
    const d = await seededDb()
    const msgs = [{ from: 'interviewer' as const, text: 'q?' }, { from: 'you' as const, text: 'a' }]
    await askInterviewer(d, ITEM, msgs, { design: 'DIAGRAM\nGateway 1 [gateway]' })
    await askInterviewer(d, ITEM, msgs, { hint: true })
    const [turn, hint] = spy.mock.calls.map(c => (c[1] as { context: { design?: string; hint?: boolean } }).context)
    expect(turn.design).toBe('DIAGRAM\nGateway 1 [gateway]')
    expect(turn.hint).toBeUndefined()
    expect(hint.hint).toBe(true)
    expect((await d.aiLog.toArray()).map(r => r.job)).toEqual(['interview', 'interview'])
  })

  it('DESIGN-52: opener + 3 answers + 1 hint log five interview rows, and the grade logs exactly one grade row', async () => {
    const d = await seededDb()
    const msgs: { from: 'interviewer' | 'you'; text: string }[] = []
    for (let i = 0; i < 3; i++) {
      const q = await askInterviewer(d, ITEM, msgs)
      expect(q.ok).toBe(true)
      msgs.push({ from: 'interviewer', text: q.ok ? q.value : '' }, { from: 'you', text: `answer ${i}` })
    }
    await askInterviewer(d, ITEM, msgs, { hint: true })
    await askInterviewer(d, ITEM, msgs)
    expect((await d.aiLog.toArray()).map(r => r.job)).toEqual(['interview', 'interview', 'interview', 'interview', 'interview'])
    await gradeInterview(d, ITEM, msgs)
    const jobs = (await d.aiLog.toArray()).map(r => r.job)
    expect(jobs.filter(j => j === 'grade')).toHaveLength(1)
    expect(jobs.filter(j => j === 'interview')).toHaveLength(5)
  })

  it('the final grade goes through the grade job with the transcript and the digest (DESIGN-52)', async () => {
    const d = await seededDb()
    const r = await gradeInterview(d, ITEM, [{ from: 'you', text: 'a' }], 'DIAGRAM\nnot written')
    expect(r.ok).toBe(true)
    expect(spy.mock.calls[0][0]).toBe('grade')
    const ctx = (spy.mock.calls[0][1] as unknown as { context: Record<string, unknown> }).context
    expect(ctx).toMatchObject({ sessionGrade: true, design: 'DIAGRAM\nnot written', deepDives: ['a', 'b', 'c', 'd'] })
    expect((await d.aiLog.toArray()).map(r => r.job)).toEqual(['grade'])
  })

  it('freshDigest reads the stored session, so queued notes are included once the queue is flushed', async () => {
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'ai-partner', deepDives: ['a'], nowMs: T })
    await saveNotes(d, s.id, { ...emptyNotes(), assumptions: 'RPS 20000' })
    expect(await freshDigest(d, s.id, 3000)).toContain('RPS 20000')
    expect(await freshDigest(d, 'nope', 3000)).toBe('')
  })

  const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length
  const worst = (unit: string, n: number) => Array.from({ length: 19 }, (_, i) => ({ from: (i % 2 ? 'you' : 'interviewer') as 'you' | 'interviewer', text: unit.repeat(n) }))

  it('worst case: 19 quote/backslash-heavy 2,000-character messages plus an 8,000-character digest stay under the helper body limit (Review Focus 5)', async () => {
    const d = await seededDb()
    const raw = { ticket: 't', context: { transcript: worst('"\\', 1000), design: '"\\'.repeat(4000) } }
    // the unclipped request really is over the limit, so this test exercises the JSON-escaped size
    expect(bytes(raw)).toBeGreaterThan(MAX_BODY_BYTES)
    await gradeInterview(d, ITEM, worst('"\\', 1000), '"\\'.repeat(4000))
    await askInterviewer(d, ITEM, worst('"\n', 1000), { design: '"\n'.repeat(4000) })
    expect(spy.mock.calls).toHaveLength(2)
    for (const c of spy.mock.calls) {
      const req = c[1] as { ticket: unknown; context: { design?: string; transcript: { text: string }[] } }
      expect(bytes({ ticket: req.ticket, context: req.context })).toBeLessThan(MAX_BODY_BYTES)
      expect(req.context.design).toBeTruthy()
      expect(req.context.transcript).toHaveLength(19)
    }
  })

  it('worst case in encoded bytes: 4-byte emoji and control characters are clipped by size, not by length', async () => {
    const d = await seededDb()
    await gradeInterview(d, ITEM, worst('\u{1F600}', 1000), '\u0001'.repeat(8000))
    await askInterviewer(d, ITEM, worst('\u0001', 2000), { design: '\u{1F600}'.repeat(4000) })
    for (const c of spy.mock.calls) {
      const req = c[1] as { ticket: unknown; context: unknown }
      expect(bytes({ ticket: req.ticket, context: req.context })).toBeLessThan(MAX_BODY_BYTES)
    }
  })

  it('an ordinary request is sent untouched (clipping only engages when the body would not fit)', async () => {
    const d = await seededDb()
    const design = 'DIAGRAM\n' + 'x'.repeat(7000)
    await gradeInterview(d, ITEM, worst('y', 500), design)
    const ctx = (spy.mock.calls[0][1] as { context: { design: string; transcript: { text: string }[] } }).context
    expect(ctx.design).toBe(design)
    expect(ctx.transcript.every(m => m.text.length === 500)).toBe(true)
  })

  it('a 70-message, 2,000-character, quote-heavy chat sent to the grade stays under MAX_BODY_BYTES in encoded bytes', async () => {
    const d = await seededDb()
    const chat = Array.from({ length: 70 }, (_, i) => ({ from: (i % 2 ? 'you' : 'interviewer') as 'you' | 'interviewer', text: '"\\'.repeat(1000) }))
    expect(bytes({ ticket: 't', context: { transcript: chat } })).toBeGreaterThan(MAX_BODY_BYTES)
    const r = await gradeInterview(d, ITEM, chat, '"\\'.repeat(4000))
    expect(r.ok).toBe(true)
    expect(spy.mock.calls).toHaveLength(1)
    const req = spy.mock.calls[0][1] as { ticket: unknown; context: { transcript: unknown[] } }
    expect(bytes({ ticket: req.ticket, context: req.context })).toBeLessThan(MAX_BODY_BYTES)
    expect(req.context.transcript.length).toBeGreaterThan(0)
  })

  it('a raw failure text from the grade or the reference never carries the stored job name to the learner', async () => {
    const d = await seededDb()
    const failed = { ok: false as const, code: 'claude_failed' as const, error: 'The interview job failed; interviewers are busy', provider: 'fake' as const, ms: 1 }
    spy.mockResolvedValueOnce(failed as never)
    const g = await gradeInterview(d, ITEM, [])
    spy.mockResolvedValueOnce(failed as never)
    const dg = await drawReference(d, ITEM)
    for (const r of [g, dg]) {
      expect(r.ok).toBe(false)
      expect(r.ok ? '' : r.error).not.toMatch(/interview/i)
      expect(r.ok ? '' : r.error).toMatch(/session job failed/)
    }
  })
})

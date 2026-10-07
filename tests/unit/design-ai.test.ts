import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runJob } from '../../src/ai/client'
import { TRANSCRIPT_TEXT_MAX } from '../../src/ai/prompts'
import { setNow } from '../../src/lib/clock'
import type { PlanDesignRef } from '../../src/rules/designs'
import { askInterviewer, drawReference, gradeInterview } from '../../src/screens/designSession/designAi'
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

  it('final grade and reference diagram log their jobs too', async () => {
    const d = await seededDb()
    expect((await gradeInterview(d, ITEM, [])).ok).toBe(true)
    expect((await drawReference(d, ITEM)).ok).toBe(true)
    expect((await d.aiLog.toArray()).map(r => r.job)).toEqual(['interview', 'diagram'])
  })
})

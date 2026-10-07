import { describe, expect, it, vi } from 'vitest'
import { draftBrief } from '../../src/data/briefActions'
import { freshDb } from '../helpers/db'
import { mkTicket } from '../helpers/tickets'

// The model ignores the ban: a forge brief with code is rejected as invalid_output and nothing is saved.
vi.mock('../../src/ai/client', async orig => {
  const m = await orig<typeof import('../../src/ai/client')>()
  return {
    ...m,
    runJob: async (job: string, req: { ticket: { title: string } | null }, o?: unknown) => {
      const r = await m.runJob(job as 'brief', req as never, o as never)
      if (r.ok && job === 'brief' && req.ticket?.title === 'NoQ') return { ...r, output: { ...r.output, deliverable: { kind: 'code', prompt: 'p' }, questions: [] } }
      if (r.ok && job === 'brief') return { ...r, output: { ...r.output, outcome: 'Run `pytest` until green' } }
      return r
    },
  }
})

describe('forge briefs with code are rejected', () => {
  it('a forge card gets invalid_output and no brief; a non-forge card keeps its backticks', async () => {
    const d = freshDb()
    await d.tickets.bulkPut([mkTicket({ id: 's', track: 'ai', kind: 'stage', title: 'Stage X' }), mkTicket({ id: 'p', track: 'interview', kind: 'problem', title: 'Two Sum' })])
    expect(await draftBrief(d, 's', 1)).toEqual({ ok: false, code: 'invalid_output', error: 'invalid brief output: a forge brief must not contain code (a fence, backticks or code-looking lines)' })
    expect((await d.tickets.get('s'))!.brief).toBeUndefined()
    expect(await draftBrief(d, 'p', 1)).toEqual({ ok: true, drafted: true })
    expect((await d.tickets.get('p'))!.brief!.outcome).toContain('`pytest`')
  })

  it('a watch card that comes back without questions is rejected as invalid_output and nothing is saved', async () => {
    const d = freshDb()
    await d.tickets.put(mkTicket({ id: 'w', kind: 'watch', track: 'interview', title: 'NoQ' }))
    expect(await draftBrief(d, 'w', 1)).toEqual({ ok: false, code: 'invalid_output', error: 'invalid brief output: a watch or read card needs an answers deliverable with questions' })
    expect((await d.tickets.get('w'))!.brief).toBeUndefined()
  })

  it('the fake variants: invalid and forge-code are refused and save nothing (BR-20)', async () => {
    const d = freshDb()
    await d.tickets.bulkPut([mkTicket({ id: 'p', track: 'interview', kind: 'problem', title: 'Two Sum' }), mkTicket({ id: 's', track: 'ai', kind: 'stage', session: 'build', title: 'Stage X build' })])
    localStorage.setItem('dojo:fake-ai-brief', 'invalid')
    const r = await draftBrief(d, 'p', 1)
    expect(r).toMatchObject({ ok: false, code: 'invalid_output' })
    expect(r.ok === false && r.error).toContain('steps')
    expect((await d.tickets.get('p'))!.brief).toBeUndefined()
    localStorage.setItem('dojo:fake-ai-brief', 'forge-code')
    expect(await draftBrief(d, 's', 1)).toMatchObject({ ok: false, code: 'invalid_output' })
    expect((await d.tickets.get('s'))!.brief).toBeUndefined()
    localStorage.removeItem('dojo:fake-ai-brief')
  })
})

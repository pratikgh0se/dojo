import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { saveNotes, startDesignSession } from '../../src/data/designSessionActions'
import { emptyNotes } from '../../src/rules/designNotes'
import { useWriteQueue } from '../../src/screens/designSession/useWriteQueue'
import { seededDb } from '../helpers/db'

const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']

async function setup() {
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: 1_000 })
  const { result } = renderHook(() => useWriteQueue(() => {}))
  const count = { tx: 0 }
  const real = d.transaction.bind(d) as (...a: unknown[]) => unknown
  ;(d as unknown as { transaction: unknown }).transaction = (...a: unknown[]) => { count.tx++; return real(...a) }
  return { d, s, q: result, count }
}

describe('notes writes through the queue (DESIGN-16)', () => {
  it('N rapid saveNotes calls open at most two transactions and the stored notes are the last snapshot', async () => {
    const { d, s, q, count } = await setup()
    const text = 'what about offline?'
    act(() => {
      for (let i = 1; i <= text.length; i++) {
        const next = { ...emptyNotes(), open: text.slice(0, i) }
        q.current.push(() => saveNotes(d, s.id, next), `notes:${s.id}`)
      }
    })
    await act(async () => { await q.current.flush() })
    expect(count.tx).toBeLessThanOrEqual(2)
    expect((await d.designSessions.get(s.id))?.notes?.open).toBe(text)
  })

  it('a pagehide-style flushNow with a pending snapshot starts its transaction in the same tick', async () => {
    const { d, s, q, count } = await setup()
    act(() => {
      q.current.push(() => saveNotes(d, s.id, { ...emptyNotes(), open: 'first' }), `notes:${s.id}`)
      q.current.push(() => saveNotes(d, s.id, { ...emptyNotes(), open: 'last' }), `notes:${s.id}`)
    })
    expect(count.tx).toBe(0) // still waiting its turn in the chain
    act(() => q.current.flushNow())
    expect(count.tx).toBe(1) // synchronous: before any await
    await act(async () => { await q.current.flush() })
    expect((await d.designSessions.get(s.id))?.notes?.open).toBe('last')
  })
})

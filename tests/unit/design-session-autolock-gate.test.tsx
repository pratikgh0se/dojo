import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as actions from '../../src/data/designSessionActions'
import { startDesignSession } from '../../src/data/designSessionActions'
import { syncGate } from '../../src/data/db'
import { ReadOnlyError } from '../../src/data/writer'
import { setNow } from '../../src/lib/clock'
import { findDesign } from '../../src/rules/designs'
import { LiveSession } from '../../src/screens/designSession/LiveSession'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// DESIGN-17 / DESIGN-79: a drawing session past 45:00 locks itself, but never in a window whose writes are refused
// (read-only browser: syncGate.readOnly; newer-model data: syncGate.modelLocked). There it must not retry every second,
// must not toast, and the canvas and notes render locked. A failed lock is attempted once per session, not once per tick.

const T = new Date('2026-10-11T10:00:00+05:30').getTime()
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']

describe('45:00 auto-lock with refused writes (DESIGN-17, DESIGN-79)', () => {
  const orig = { readOnly: syncGate.readOnly, modelLocked: syncGate.modelLocked }
  let cur = T

  beforeEach(() => {
    cur = T
    setNow(() => cur)
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    syncGate.readOnly = orig.readOnly
    syncGate.modelLocked = orig.modelLocked
  })

  async function openOverdue() {
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 50 * MIN })
    const item = findDesign(flatPlanV2, 'd-method')!
    const flush = vi.fn(async () => {})
    const view = renderWithApp(
      <LiveSession item={item} session={s} push={job => { void job() }} flush={flush} savedAt={null} />,
      { db: d, plan: flatPlanV2 },
    )
    return { d, s, flush, ...view }
  }

  async function tick(seconds: number) {
    for (let i = 0; i < seconds; i++) {
      cur += 1000
      await act(async () => { vi.advanceTimersByTime(1000) })
    }
  }

  const expectLocked = () => {
    expect(screen.getByTestId('kit-canvas')).toHaveAttribute('data-locked', 'true')
    expect(screen.getByTestId('notes-field-req-fn')).toHaveAttribute('readonly')
  }

  for (const flag of ['readOnly', 'modelLocked'] as const) {
    it(`does not write, toast or retry when syncGate.${flag} is set, and renders locked`, async () => {
      syncGate[flag] = true
      const lock = vi.spyOn(actions, 'flushThenLock')
      const { d, s } = await openOverdue()
      await tick(5)
      expect(lock).not.toHaveBeenCalled()
      expect(screen.queryAllByTestId('toast')).toHaveLength(0)
      expect((await d.designSessions.get(s.id))?.phase).toBe('drawing')
      expectLocked()
    })
  }

  it('locks exactly once in a writer window', async () => {
    const lock = vi.spyOn(actions, 'flushThenLock')
    const { d, s } = await openOverdue()
    await tick(5)
    expect(lock).toHaveBeenCalledTimes(1)
    expect((await d.designSessions.get(s.id))?.phase).toBe('close')
  })

  it('does not retry a failed lock on every tick', async () => {
    const lock = vi.spyOn(actions, 'flushThenLock').mockRejectedValueOnce(new ReadOnlyError())
    await openOverdue()
    await tick(5)
    expect(lock).toHaveBeenCalledTimes(1)
    expect(screen.queryAllByTestId('toast')).toHaveLength(1)
  })
})

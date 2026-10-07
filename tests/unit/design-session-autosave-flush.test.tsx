import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLOSE_QUESTIONS } from '../../src/content/tracking'
import { enterScore, lockDesignSession, startDesignSession } from '../../src/data/designSessionActions'
import type { CloseAnswers } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import * as writeQueueModule from '../../src/screens/designSession/useWriteQueue'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-11T10:00:00')
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

async function openDrawing() {
  setNow(() => T)
  const d = await seededDb()
  await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 10 * MIN })
  const view = renderWithApp(<DesignSessionScreen />, { db: d, plan: smallPlan, route: '/designs/session/d-method', path: '/designs/session/:designId' })
  await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('drawing'))
  return { d, ...view }
}

// Captured once, before any spying rebinds the module's exported `useWriteQueue`.
const REAL_USE_WRITE_QUEUE = writeQueueModule.useWriteQueue

describe('D-23 autosave: flush on unmount/route change/visibilitychange/pagehide', () => {
  const originalVisibility = document.visibilityState
  const spyOnUseWriteQueue = () => vi.spyOn(writeQueueModule, 'useWriteQueue')
  let flushSpy: ReturnType<typeof spyOnUseWriteQueue>

  beforeEach(() => {
    flushSpy = spyOnUseWriteQueue()
  })
  afterEach(() => {
    setVisibility(originalVisibility)
    vi.restoreAllMocks()
  })

  it('flushes pending saves when the tab is hidden', async () => {
    const { flush } = await withFlushSpy(openDrawing)
    setVisibility('hidden')
    fireEvent(document, new Event('visibilitychange'))
    expect(flush).toHaveBeenCalled()
  })

  it('flushes pending saves on pagehide', async () => {
    const { flush } = await withFlushSpy(openDrawing)
    fireEvent(window, new Event('pagehide'))
    expect(flush).toHaveBeenCalled()
  })

  it('flushes pending saves when the session view unmounts (route change)', async () => {
    const { flush, unmount } = await withFlushSpy(openDrawing)
    unmount()
    expect(flush).toHaveBeenCalled()
  })

  // Wires a spy onto the real useWriteQueue's returned `flush` (keeping push/flush real, so this
  // also proves the wiring calls the actual queue, not a no-op) and runs `run`, returning the spy
  // plus whatever `run` returned.
  async function withFlushSpy<T extends { unmount: () => void }>(run: () => Promise<T>) {
    const flush = vi.fn()
    flushSpy.mockImplementation(onError => {
      const q = REAL_USE_WRITE_QUEUE(onError)
      flush.mockImplementation(q.flush)
      return { ...q, flush }
    })
    const result = await run()
    return { ...result, flush }
  }
})

describe('D-23 addendum: flush runs before the lock (End-drawing confirm and 45:00 auto-lock)', () => {
  const spyOnUseWriteQueue = () => vi.spyOn(writeQueueModule, 'useWriteQueue')
  let uwqSpy: ReturnType<typeof spyOnUseWriteQueue>

  beforeEach(() => {
    uwqSpy = spyOnUseWriteQueue()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // The true flush-before-lock ordering guarantee is unit-tested directly against `flushThenLock`
  // in design-session-actions.test.ts (spying on lockDesignSession can't observe flushThenLock's
  // internal same-module call to it). This just proves the queue's real flush is actually reached
  // on both paths, not skipped.
  function spyFlush() {
    const flush = vi.fn()
    uwqSpy.mockImplementation(onError => {
      const real = REAL_USE_WRITE_QUEUE(onError)
      flush.mockImplementation(real.flush)
      return { push: real.push, flush }
    })
    return flush
  }

  it('flushes the write queue before locking on End drawing (D-8, D-23 addendum)', async () => {
    const flush = spyFlush()
    await openDrawing()
    fireEvent.click(screen.getByRole('button', { name: 'End drawing' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'End drawing now?' })).getByRole('button', { name: 'End drawing' }))
    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('close'))
    expect(flush).toHaveBeenCalled()
  })

  it('flushes the write queue before the 45:00 auto-lock (D-23 addendum)', async () => {
    const flush = spyFlush()
    setNow(() => T)
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 5 * 60 * MIN })
    renderWithApp(<DesignSessionScreen />, { db: d, plan: smallPlan, route: '/designs/session/d-method', path: '/designs/session/:designId' })
    await waitFor(() => expect(screen.getByTestId('session-phase')).toHaveTextContent('close'))
    expect(flush).toHaveBeenCalled()
    expect((await d.designSessions.get(s.id))?.phase).toBe('close')
  })
})

const CLOSE: CloseAnswers = {
  tradeoff: { chose: 'sliding window counter in Redis', over: 'token bucket per node', because: 'global limit needs shared state; 2 ms Redis RTT is fine' },
  breaksAt10x: 'Redis hot key', dataOwnership: 'Redis owns counters', couldNotAnswer: 1, readNext: 'Stripe rate limiter blog post',
}

describe('Close and Score share the lifted write queue: flush covers them on pagehide/unmount', () => {
  const originalVisibility = document.visibilityState
  const spyOnUseWriteQueue = () => vi.spyOn(writeQueueModule, 'useWriteQueue')
  let flushSpy: ReturnType<typeof spyOnUseWriteQueue>

  beforeEach(() => {
    flushSpy = spyOnUseWriteQueue()
  })
  afterEach(() => {
    setVisibility(originalVisibility)
    vi.restoreAllMocks()
  })

  // Same wiring proof as the canvas describe above: spy on the real useWriteQueue's `flush` so we
  // know the actual shared queue (not a no-op) is what gets flushed.
  async function withFlushSpy<T extends { unmount: () => void }>(run: () => Promise<T>) {
    const flush = vi.fn()
    flushSpy.mockImplementation(onError => {
      const q = REAL_USE_WRITE_QUEUE(onError)
      flush.mockImplementation(q.flush)
      return { ...q, flush }
    })
    const result = await run()
    return { ...result, flush }
  }

  async function openClose() {
    setNow(() => T)
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 12 * MIN })
    await lockDesignSession(d, s.id, T)
    const view = renderWithApp(<DesignSessionScreen />, { db: d, plan: smallPlan, route: '/designs/session/d-method', path: '/designs/session/:designId' })
    await screen.findByTestId('session-close')
    return { d, id: s.id, ...view }
  }

  async function openScore() {
    setNow(() => T)
    const d = await seededDb()
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: T - 12 * MIN })
    await lockDesignSession(d, s.id, T)
    await enterScore(d, s.id, CLOSE)
    const view = renderWithApp(<DesignSessionScreen />, { db: d, plan: smallPlan, route: '/designs/session/d-method', path: '/designs/session/:designId' })
    await screen.findByTestId('session-score')
    return { d, id: s.id, ...view }
  }

  // The decisive assertion: before the fix, CloseForm/ScoreForm each call their own `useWriteQueue`
  // in addition to the one SessionView lifts, so this hook is called twice and the pagehide/unmount
  // handler (wired to SessionView's instance only) never touches the form's own chain. A shared,
  // lifted queue means the hook is called exactly once for the whole tree.
  it('instantiates the write queue exactly once for the whole session tree on Close', async () => {
    await withFlushSpy(openClose)
    expect(flushSpy).toHaveBeenCalledTimes(1)
  })

  it('instantiates the write queue exactly once for the whole session tree on Score', async () => {
    await withFlushSpy(openScore)
    expect(flushSpy).toHaveBeenCalledTimes(1)
  })

  it('flushes a Close answer typed just before pagehide, and it lands', async () => {
    const { d, id, flush } = await withFlushSpy(openClose)
    const close = screen.getByTestId('session-close')
    fireEvent.change(within(close).getByRole('textbox', { name: CLOSE_QUESTIONS[4] }), { target: { value: 'DDIA' } })
    fireEvent(window, new Event('pagehide'))
    expect(flush).toHaveBeenCalled()
    await waitFor(async () => expect((await d.designSessions.get(id))?.close.readNext).toBe('DDIA'))
  })

  it('flushes a Close answer typed just before visibilitychange(hidden)', async () => {
    const { flush } = await withFlushSpy(openClose)
    const close = screen.getByTestId('session-close')
    fireEvent.change(within(close).getByRole('textbox', { name: CLOSE_QUESTIONS[4] }), { target: { value: 'DDIA' } })
    setVisibility('hidden')
    fireEvent(document, new Event('visibilitychange'))
    expect(flush).toHaveBeenCalled()
  })

  it('flushes a Close answer typed just before the session view unmounts', async () => {
    const { d, id, flush, unmount } = await withFlushSpy(openClose)
    const close = screen.getByTestId('session-close')
    fireEvent.change(within(close).getByRole('textbox', { name: CLOSE_QUESTIONS[4] }), { target: { value: 'DDIA' } })
    unmount()
    expect(flush).toHaveBeenCalled()
    await waitFor(async () => expect((await d.designSessions.get(id))?.close.readNext).toBe('DDIA'))
  })

  it('flushes a Score rubric typed just before pagehide, and it lands', async () => {
    const { d, id, flush } = await withFlushSpy(openScore)
    const score = screen.getByTestId('session-score')
    fireEvent.change(within(score).getByRole('spinbutton', { name: 'Rubric (0–20)' }), { target: { value: '17' } })
    fireEvent(window, new Event('pagehide'))
    expect(flush).toHaveBeenCalled()
    await waitFor(async () => expect((await d.designSessions.get(id))?.rubric).toBe(17))
  })

  it('flushes a Score rubric typed just before the session view unmounts', async () => {
    const { d, id, flush, unmount } = await withFlushSpy(openScore)
    const score = screen.getByTestId('session-score')
    fireEvent.change(within(score).getByRole('spinbutton', { name: 'Rubric (0–20)' }), { target: { value: '17' } })
    unmount()
    expect(flush).toHaveBeenCalled()
    await waitFor(async () => expect((await d.designSessions.get(id))?.rubric).toBe(17))
  })
})

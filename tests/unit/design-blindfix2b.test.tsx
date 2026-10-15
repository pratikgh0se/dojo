import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncGate } from '../../src/data/db'
import type { DesignSession } from '../../src/data/types'
import { setNow, resetNow } from '../../src/lib/clock'
import { useSecondsNow } from '../../src/lib/useNow'
import { clockText, remainingMs } from '../../src/rules/designSession'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-11-04T10:00:00')
const MIN = 60_000

/** The rail's countdown in miniature: the session began at `at`, the component mounts some milliseconds later. */
function Countdown({ at }: { at: number }) {
  const t = useSecondsNow(at)
  return <span data-testid="clock">{clockText(remainingMs({ at }, t))}</span>
}

describe('the countdown ticks on the session\'s own seconds (DESIGN-06)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T) })
  afterEach(() => { vi.useRealTimers(); resetNow() })

  it('drops by one second per second from the first reading, even when the rail mounted 400 ms after Start', () => {
    const at = T - 400 // Start was pressed 400 ms before this component mounted
    render(<Countdown at={at} />)
    const read = () => screen.getByTestId('clock').textContent
    expect(read()).toBe('45:00')
    // the reading one second after the first (T + 1000) must already be one second lower: with a plain 1 s interval started at mount it still read 45:00
    act(() => { vi.advanceTimersByTime(1000) })
    expect(read()).toBe('44:59')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(read()).toBe('44:58')
    act(() => { vi.advanceTimersByTime(1000) })
    expect(read()).toBe('44:57')
  })

  it('drops at the second boundary itself, not a tick later (anchor and mount on the same instant)', () => {
    render(<Countdown at={T} />)
    expect(screen.getByTestId('clock').textContent).toBe('45:00')
    act(() => { vi.advanceTimersByTime(999) })
    expect(screen.getByTestId('clock').textContent).toBe('45:00')
    act(() => { vi.advanceTimersByTime(1) })
    expect(screen.getByTestId('clock').textContent).toBe('44:59')
  })
})

const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
async function done(extra: Partial<DesignSession>) {
  setNow(() => T)
  const d = await seededDb()
  await d.designSessions.add({
    id: 'ds-1', designId: 'd-method', at: T - 60 * MIN, phase: 'done', endedAt: T - 5 * MIN, lockedAt: T - 48 * MIN, minutes: 12,
    mode: 'solo', view: '2d', canvas: { layout: 'manual', nodes: [], links: [], zones: [], flows: [] },
    close: { tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 1, readNext: 'DDIA' },
    deepDives: DIVES.map((q, i) => ({ q, answered: ([2, 1, 2, 0] as const)[i] })),
    tradeoffs: [{ chose: 'a', over: 'b', because: 'c' }, { chose: 'd', over: 'e', because: 'f' }], rubric: 14, rubricBy: 'self',
    lenses: {},
    ...extra,
  } as DesignSession)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method?session=ds-1', path: '/designs/session/:designId' })
  await screen.findByTestId('session-summary')
  return d
}

describe('every finished session shows its grade (GLOBAL-10 session-grade, With someone included)', () => {
  afterEach(() => { localStorage.clear(); syncGate.readOnly = false; resetNow() })

  it('With someone: the total the host confirmed and, when the partner\'s five rows add up to it, the five items', async () => {
    await done({
      mode: 'human-partner', rubric: 14, rubricBy: 'partner',
      partner: { name: 'Sam', at: T - 10 * MIN, scores: { perItem: [4, 3, 3, 2, 2], deepDives: [2, 1, 2, 0] } },
    })
    const grade = await screen.findByTestId('session-grade')
    expect(screen.getByTestId('session-grade-total')).toHaveTextContent('14 of 20')
    const items = [1, 2, 3, 4, 5].map(n => Number(screen.getByTestId(`session-grade-item-${n}`).getAttribute('data-score')))
    expect(items).toEqual([4, 3, 3, 2, 2])
    expect(items.reduce((a, b) => a + b, 0)).toBe(14)
    expect(grade).toHaveTextContent('Scored by your partner, Sam')
  })

  it('With someone, host changed the rubric: the total stands alone (items would not add up to it)', async () => {
    await done({
      mode: 'human-partner', rubric: 17, rubricBy: 'self',
      partner: { name: 'Sam', at: T - 10 * MIN, scores: { perItem: [4, 3, 3, 2, 2], deepDives: [2, 1, 2, 0] } },
    })
    await screen.findByTestId('session-grade')
    expect(screen.getByTestId('session-grade-total')).toHaveTextContent('17 of 20')
    expect(screen.queryByTestId('session-grade-item-1')).toBeNull()
  })

  it('Solo: the self-scored total', async () => {
    await done({ mode: 'solo', rubric: 12 })
    await screen.findByTestId('session-grade')
    expect(screen.getByTestId('session-grade-total')).toHaveTextContent('12 of 20')
  })

  it('the grade total is not inside a paragraph, label or button (GLOBAL-04: pixel type only on its own element)', async () => {
    await done({ mode: 'human-partner', rubric: 14, rubricBy: 'partner', partner: { name: 'Sam', scores: { perItem: [4, 3, 3, 2, 2], deepDives: [2, 1, 2, 0] } } })
    const total = await screen.findByTestId('session-grade-total')
    expect(total.closest('p, label, button, li, td, th')).toBeNull()
  })
})


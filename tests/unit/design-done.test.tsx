import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { DesignSession } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-11T11:00:00')
const MIN = 60_000
const S1_CANVAS = {
  layout: 'manual',
  nodes: [
    { id: 'gateway-1', kind: 'gateway', label: 'Gateway 1', x: 1, y: 1 }, { id: 'service-1', kind: 'service', label: 'Service 1', x: 7, y: 1 },
    { id: 'cache-1', kind: 'cache', label: 'Cache 1', x: 13, y: 1 }, { id: 'sql-1', kind: 'sql', label: 'Sql 1', x: 19, y: 1 },
  ],
  links: [
    { from: 'gateway-1', to: 'service-1', kind: 'async' }, { from: 'service-1', to: 'cache-1', kind: 'sync' },
    { from: 'service-1', to: 'sql-1', kind: 'write' },
  ],
  zones: [], flows: [],
}
const REF = {
  layout: 'layered',
  nodes: [
    { id: 'client', kind: 'browser', label: 'Client' }, { id: 'gw', kind: 'gateway', label: 'Gateway' },
    { id: 'svc', kind: 'service', label: 'Service' }, { id: 'store', kind: 'nosql', label: 'Counters' },
  ],
  links: [{ from: 'client', to: 'gw', kind: 'sync' }, { from: 'gw', to: 'svc', kind: 'sync' }, { from: 'svc', to: 'store', kind: 'write' }],
  zones: [], flows: [{ path: ['client', 'gw', 'svc', 'store'], packet: 'request', label: 'hot path' }],
}

async function done(extra: Partial<DesignSession> = {}) {
  setNow(() => T)
  const d = await seededDb()
  const row = {
    id: 'ds-1', designId: 'd-method', at: T - 60 * MIN, phase: 'done', endedAt: T - 5 * MIN, lockedAt: T - 48 * MIN, minutes: 12,
    mode: 'solo', view: '2d', canvas: S1_CANVAS,
    close: { tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 1, readNext: 'DDIA' },
    deepDives: [2, 1, 2, 0].map((answered, i) => ({ q: ['Requirements', 'API first', 'One deep dive', 'Failure modes'][i], answered })),
    tradeoffs: [{ chose: 'a', over: 'b', because: 'c' }, { chose: 'd', over: 'e', because: 'f' }], rubric: 12, rubricBy: 'self',
    lenses: { load: 2, data: 1, consistency: 1, failure: 0, latency: 2, cost: 1, evolution: 1 }, redesignDue: ist('2026-11-10T00:00:00'),
    ...extra,
  } as DesignSession
  await d.designSessions.add(row)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: smallPlan, route: '/designs/session/d-method?session=ds-1', path: '/designs/session/:designId' })
  await screen.findByTestId('session-summary')
  return d
}
const items = (id: string) => within(screen.getByTestId(id)).queryAllByTestId('session-diff-item').map(e => e.textContent)

afterEach(() => localStorage.clear())

describe('Done view (C-DESIGN §4.8)', () => {
  it('draws the reference once, beside yours, with a diff (D-39, D-40)', async () => {
    localStorage.setItem('dojo-ai-fake-delay-ms', '30')
    const d = await done()
    expect(screen.getByTestId('session-reference-loading')).toBeInTheDocument()
    const ref = screen.getByRole('region', { name: 'Reference' })
    await waitFor(() => expect(within(ref).getByRole('button', { name: 'JSON' })).toBeInTheDocument())
    expect(screen.queryByTestId('session-reference-loading')).toBeNull()
    expect(screen.getByRole('region', { name: 'Your diagram' })).toHaveAttribute('data-testid', 'session-yours')
    expect(screen.queryByTestId('kit-node-gateway-1')).toBeNull()
    fireEvent.click(within(ref).getByRole('button', { name: 'JSON' }))
    expect(JSON.parse(screen.getByTestId('session-reference-json').textContent ?? '')).toEqual(REF)
    expect((await d.designSessions.get('ds-1'))?.reference).toEqual(REF)
    const diff = screen.getByRole('region', { name: 'Differences' })
    expect(diff).toHaveTextContent('Information, not a score.')
    expect(items('session-diff-mine')).toEqual(['cache (Cache 1)', 'sql (Sql 1)'])
    expect(items('session-diff-ref')).toEqual(['browser (Client)', 'nosql (Counters)'])
    expect(items('session-diff-links')).toEqual(['gateway → service: yours async, reference sync'])
    expect(screen.getByTestId('session-summary')).toHaveTextContent('rubric 12 / 20')
  })

  it('uses the stored reference without calling the AI again (D-41)', async () => {
    localStorage.setItem('dojo-ai-fake-fail', '*')
    await done({ reference: REF as never })
    expect(screen.queryByTestId('session-reference-loading')).toBeNull()
    expect(within(screen.getByRole('region', { name: 'Reference' })).getByRole('button', { name: 'Play flows' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByTestId('session-ai-error')).toBeNull()
  })

  it('toggles Play flows and offers both exports (D-42, D-44)', async () => {
    await done({ reference: REF as never })
    const play = screen.getByRole('button', { name: 'Play flows' })
    fireEvent.click(play)
    expect(play).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(play)
    expect(play).toHaveAttribute('aria-pressed', 'false')
    expect(within(screen.getByTestId('session-yours')).getByRole('button', { name: 'Export PNG' })).toBeInTheDocument()
    expect(within(screen.getByTestId('session-reference')).getByRole('button', { name: 'Export reference PNG' })).toBeInTheDocument()
  })

  it('shows the raw error and Retry when the reference fails (Review Focus #5)', async () => {
    localStorage.setItem('dojo-ai-fake-fail', 'diagram')
    await done()
    const ref = screen.getByRole('region', { name: 'Reference' })
    expect(await within(ref).findByText(/fake diagram unavailable/)).toBeInTheDocument()
    expect(screen.queryByTestId('session-diff')).toBeNull()
    localStorage.removeItem('dojo-ai-fake-fail')
    fireEvent.click(within(ref).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.getByTestId('session-diff')).toBeInTheDocument())
  })

  it('keeps the interviewer transcript and grade (D-38)', async () => {
    const final = {
      done: true, score: 15, oneThingToStudy: '[fake:interview] d-method', deepDives: [2, 1, 2, 1],
      lenses: { load: 2, data: 1, consistency: 1, failure: 1, latency: 1, cost: 0, evolution: 1 },
      perItem: [{ item: 'Requirements and numbers', points: 4, note: 'n' }],
    }
    await done({
      mode: 'interviewer', reference: REF as never,
      interview: { messages: [{ from: 'interviewer', text: 'q0' }, { from: 'you', text: 'a1' }, { from: 'interviewer', text: 'q1' }], final } as never,
    })
    expect(screen.getByText('Transcript', { selector: 'summary' })).toBeInTheDocument()
    expect(screen.getAllByTestId('session-msg')).toHaveLength(3)
    expect(screen.getByTestId('session-grade')).toHaveTextContent('One thing to study: [fake:interview] d-method')
  })
})

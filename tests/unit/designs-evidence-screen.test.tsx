import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { DesignSession } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { Designs } from '../../src/screens/Designs'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-11T12:00:00')
const TITLE = 'The method, on a whiteboard, in 45 minutes'

function s1(): DesignSession {
  return {
    id: 'S1', designId: 'd-method', at: ist('2026-10-11T10:00:00'), phase: 'done', endedAt: ist('2026-10-11T11:00:00'),
    lockedAt: ist('2026-10-11T10:12:00'), minutes: 12, mode: 'solo', view: '2d',
    canvas: { layout: 'manual', nodes: ['gateway', 'service', 'cache', 'sql'].map((k, i) => ({ id: `${k}-1`, kind: k, label: k, x: i * 6, y: 1 })), links: [], zones: [], flows: [] },
    close: { tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 1, readNext: 'Stripe rate limiter blog post' },
    deepDives: [2, 1, 2, 0].map((answered, i) => ({ q: `q${i}`, answered })) as DesignSession['deepDives'],
    tradeoffs: [], rubric: 12, lenses: { load: 2, data: 1, consistency: 1, failure: 0, latency: 2, cost: 1, evolution: 1 },
    redesignDue: ist('2026-11-10T00:00:00'),
  } as DesignSession
}

async function setup(at: number, sessions: DesignSession[] = []) {
  setNow(() => at)
  const d = await seededDb(smallPlan, '2026-09-07')
  for (const s of sessions) await d.designSessions.add(s)
  renderWithApp(<Designs />, { db: d, plan: smallPlan, route: '/designs', path: '*' })
  return screen.findByRole('region', { name: 'Design evidence' })
}

describe('Design evidence (C-DESIGN §4.11)', () => {
  it('shows the empty state (D-48)', async () => {
    const ev = await setup(T)
    const radar = within(ev).getByTestId('lens-radar')
    expect(radar).toHaveAttribute('role', 'img')
    expect(radar).toHaveAccessibleName('Lens radar · No sessions yet')
    expect(radar).toHaveTextContent('No sessions yet')
    const cells = within(ev).getAllByTestId('wall-cell')
    expect(cells).toHaveLength(8)
    expect(cells.every(c => c.dataset.state === 'none')).toBe(true)
    expect(ev).toHaveTextContent('0 of 8 answered in full')
    // UAT J2 / r3: plain words for what it counts, a tooltip on the counter and the wall's key
    expect(within(ev).getByText('0 of 8 answered in full')).toHaveAttribute('title', '0 of 8 deep dives answered in full (scored 2 of 2)')
    expect(within(ev).getByTestId('wall-key')).toHaveTextContent('not answeredhand-wave (1)answered in full (2)one column per design, one row per deep dive')
    expect(within(ev).getByTestId('shelf')).toHaveTextContent('No diagrams yet')
    expect(within(ev).getByTestId('design-vocab')).toHaveTextContent('Vocabulary · 0 of 38 kinds used')
    expect(within(ev).getByTestId('lens-spark-failure')).toHaveAccessibleName('Failure trend: No sessions yet')
    expect(within(ev).getByTestId('design-redesign-rate')).toHaveTextContent('Redesign pass rate · 0 / 0')
  })

  it('shows one completed session everywhere (D-49…D-53, D-46)', async () => {
    const ev = await setup(T, [s1()])
    const radar = within(ev).getByTestId('lens-radar')
    const vals = 'Load 2.0, Data 1.0, Consistency 1.0, Failure 0.0, Latency 2.0, Cost 1.0, Evolution 1.0'
    expect(radar).toHaveAccessibleName(`Lens radar · last 6: ${vals} · all-time: ${vals}`)
    expect(JSON.parse(radar.dataset.last6 ?? '')).toEqual({ load: 2, data: 1, consistency: 1, failure: 0, latency: 2, cost: 1, evolution: 1 })
    const grid = within(ev).getByRole('grid', { name: 'Deep-dive wall' })
    expect(within(grid).getAllByRole('row')).toHaveLength(4)
    const cell = (dive: number) => grid.querySelector(`[data-design="d-method"][data-dive="${dive}"]`) as HTMLElement
    expect([1, 2, 3, 4].map(i => cell(i).dataset.state)).toEqual(['ok', 'glow', 'ok', 'none'])
    expect(cell(2)).toHaveAccessibleName(`${TITLE} · deep dive 2 · hand-wave`)
    expect(ev).toHaveTextContent('2 of 8 answered in full')
    expect(within(ev).getByTestId('lens-spark-failure')).toHaveAccessibleName('Failure trend: 0')
    const thumb = within(within(ev).getByTestId('shelf-tier-1')).getByRole('link')
    expect(thumb).toHaveAccessibleName(`${TITLE} · 2026-10-11 · 4 nodes`)
    expect(thumb).toHaveAttribute('href', '/designs/session/d-method?session=S1')
    expect(within(ev).getByTestId('design-vocab')).toHaveTextContent('Vocabulary · 4 of 38 kinds used')
    const row = within(ev).getByTestId('design-redesign-d-method')
    expect(row).toHaveTextContent(TITLE)
    expect(row).toHaveTextContent('due 2026-11-10')
    expect(row).toHaveTextContent('queued')
    expect(row).toHaveTextContent('Read: Stripe rate limiter blog post')
    expect(within(row).queryByRole('link')).toBeNull()
    expect(screen.getByTestId('designs-sundays')).toHaveTextContent('2 deep dives answered')
    fireEvent.click(cell(1))
    expect(screen.getByTestId('location')).toHaveTextContent('/designs/session/d-method')
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?session=S1')
  })

  it('offers the redesign when due (D-46)', async () => {
    const ev = await setup(ist('2026-11-10T09:00:00'), [s1()])
    const row = within(ev).getByTestId('design-redesign-d-method')
    expect(row).toHaveTextContent('due')
    expect(within(row).getByRole('link', { name: `Start redesign: ${TITLE}` })).toHaveAttribute('href', '/designs/session/d-method')
  })
})

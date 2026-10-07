import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { moveTicket } from '../../src/data/boardActions'
import type { PlanJson } from '../../src/data/types'
import { setNow } from '../../src/lib/clock'
import { MapView } from '../../src/screens/Map'
import { seededDb } from '../helpers/db'
import { smallPlan } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

// smallPlan ticket skills: m1w1t1 aieng; m1w1i1, m1w2i1, p200, p127, p1 dsa; m1w2t1, m1w3t1 math; d-method, d-estimate sysd.
const mapPlan = (): PlanJson => ({
  ...smallPlan,
  skills: [
    { id: 'math', label: 'Math', tier: 0, needs: [], what: 'Math what', why: 'Math why' },
    { id: 'py', label: 'Python', tier: 0, needs: [], what: 'Py what', why: 'Py why' },
    { id: 'aieng', label: 'AI engineering', tier: 1, needs: ['py'], what: 'AI what', why: 'AI why' },
    { id: 'dsa', label: 'Data structures', tier: 1, needs: ['math'], what: 'DSA what', why: 'DSA why' },
    { id: 'sysd', label: 'System design', tier: 2, needs: ['dsa'], what: 'Sys what', why: 'Sys why' },
  ],
  phases: [{ n: 'Foundations', months: [1], note: 'first block' }],
})

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const NOW = ist('2026-09-08T10:00:00')
const state = (id: string) => screen.getByTestId(`node-${id}`).getAttribute('data-state')

async function setup(route = '/map', plan: PlanJson = mapPlan()) {
  setNow(() => NOW)
  const d = await seededDb(plan)
  renderWithApp(<MapView />, { db: d, plan, route, path: '/map' })
  await screen.findByRole('heading', { name: 'Sprint path' })
  return d
}

describe('Map screen', () => {
  it('draws node states from live progress: zero-ticket parents never block (Review Focus #4)', async () => {
    await setup()
    expect(state('math')).toBe('open')
    expect(state('py')).toBe('open')
    expect(state('aieng')).toBe('open')
    expect(state('dsa')).toBe('locked')
    expect(state('sysd')).toBe('locked')
  })

  it('unlocks a child once its parent reaches 70% (live query)', async () => {
    const d = await setup()
    await moveTicket(d, 'm1w2t1', 'done', NOW)
    await waitFor(() => expect(state('math')).toBe('active'))
    expect(state('dsa')).toBe('locked') // 1/2 = 50%
    expect(document.querySelector('[data-edge="math->dsa"]')).not.toHaveClass('met')
    await moveTicket(d, 'm1w3t1', 'done', NOW)
    await waitFor(() => expect(state('math')).toBe('done'))
    expect(state('dsa')).toBe('open')
    expect(document.querySelector('[data-edge="math->dsa"]')).toHaveClass('met')
  })

  it('follows a locked node to the parent holding it back', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('node-dsa'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?skill=dsa')
    const detail = screen.getByTestId('skill-detail')
    expect(within(detail).getByRole('heading', { name: 'Data structures' })).toBeInTheDocument()
    expect(screen.getByTestId('skill-what')).toHaveTextContent('DSA what')
    expect(screen.getByTestId('skill-why')).toHaveTextContent('DSA why')
    expect(screen.getByTestId('need-math')).toHaveTextContent('Math · 0%')
    fireEvent.click(screen.getByTestId('need-math'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?skill=math')
    expect(within(screen.getByTestId('skill-detail')).getByRole('heading', { name: 'Math' })).toBeInTheDocument()
  })

  it('opens the sprint view from a phase, steps with buttons and arrow keys', async () => {
    await setup()
    expect(screen.getByTestId('phase-0')).toHaveClass('state-current')
    fireEvent.click(screen.getByTestId('phase-0'))
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '?sprint=1')
    expect(screen.getByTestId('sprint-title')).toHaveTextContent('Sprint 1 · Block 1: B1')
    const view = screen.getByTestId('sprint-view')
    expect(view).toHaveTextContent('fa1')
    expect(view).toHaveTextContent('fi1')
    expect(within(view).getByTestId('row-m1w1t1')).toBeInTheDocument()
    expect(screen.getByTestId('sprint-prev')).toBeDisabled()
    fireEvent.click(screen.getByTestId('sprint-next'))
    expect(screen.getByTestId('sprint-title')).toHaveTextContent('Sprint 2')
    fireEvent.keyDown(screen.getByTestId('sprint-view'), { key: 'ArrowRight' })
    expect(screen.getByTestId('sprint-title')).toHaveTextContent('Sprint 3')
    expect(screen.getByTestId('sprint-next')).toBeDisabled()
    expect(screen.getByTestId('sprint-view-proof')).toHaveTextContent('A public repo')
    fireEvent.keyDown(screen.getByTestId('sprint-view'), { key: 'ArrowLeft' })
    expect(screen.getByTestId('sprint-title')).toHaveTextContent('Sprint 2')
  })

  it('jumps from a skill to the sprints holding its tickets', async () => {
    await setup('/map?skill=dsa')
    expect(screen.getByTestId('skill-sprint-1')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('skill-sprint-2'))
    expect(screen.getByTestId('sprint-title')).toHaveTextContent('Sprint 2')
  })

  it('sprint path: one cube per homed ticket, current and cleared marks', async () => {
    const d = await setup()
    const s1 = screen.getByTestId('path-1')
    expect(s1.querySelectorAll('.pc')).toHaveLength(5)
    expect(s1).toHaveClass('current')
    for (const id of ['m1w1t1', 'm1w1i1', 'p200', 'p127', 'p1']) await moveTicket(d, id, 'done', NOW)
    await waitFor(() => expect(screen.getByTestId('path-1')).toHaveClass('cleared'))
  })

  it('sprint path label: a single-sprint row shows "S<n>" without a dash; a multi-sprint row keeps the range', async () => {
    const base = mapPlan()
    const plan: PlanJson = { ...base, sprints: base.sprints.map((s, i) => (i === 0 ? { ...s, block_title: 'Solo stage' } : s)) }
    await setup('/map', plan)
    expect(screen.getByText('S1 · Solo stage')).toBeInTheDocument()
    expect(screen.getByText('S2–S3 · B1')).toBeInTheDocument()
  })

  it('hides the tree and journey when the plan has no skills or phases', async () => {
    await setup('/map', smallPlan)
    expect(screen.queryByRole('heading', { name: 'Skill tree' })).toBeNull()
    expect(screen.queryByTestId('phase-0')).toBeNull()
    expect(screen.getByTestId('path-1')).toBeInTheDocument()
  })
})

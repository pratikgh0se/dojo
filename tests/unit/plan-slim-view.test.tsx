import { render, screen, waitFor } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppProviders, usePlanV2 } from '../../src/app/providers'
import { AppRoutes } from '../../src/app/routes'
import { getSettings, patchSettings } from '../../src/data/db'
import { loadPlan, runReconcile } from '../../src/data/seed'
import { setNow } from '../../src/lib/clock'
import { freshDb } from '../helpers/db'
import { flatPlanV2, legacyForgePlan } from '../helpers/plan'

const asFetch = (body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body))) as typeof fetch

describe('loadPlan', () => {
  it('reads a v2 plan and hands the bank screens the slim view of it', async () => {
    const r = await loadPlan(asFetch(flatPlanV2))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.v2.planFormat).toBe(2)
    expect(Object.keys(r.plan).sort()).toEqual(['design_bank', 'dsa_bank', 'idMap', 'planVersion'])
    expect(r.plan.dsa_bank).toEqual(flatPlanV2.dsa_bank)
    expect(r.plan.design_bank).toEqual(flatPlanV2.design_bank)
    expect(r.plan.planVersion).toBe('fx-v2-1')
  })
  it('carries the learner block into the slim view when the plan has one', async () => {
    const r = await loadPlan(asFetch({ ...flatPlanV2, learner: { patternsRepo: 'https://example.com/me' } }))
    expect(r.ok && r.plan.learner).toEqual({ patternsRepo: 'https://example.com/me' })
  })
  it('no longer reads a v1 plan: the forge-era plan is refused with the not-a-plan-v2 message', async () => {
    const r = await loadPlan(asFetch(legacyForgePlan()))
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('is not a plan v2 (planFormat 2)') })
  })
  it('rejects anything else with the not-a-plan-v2 message (S1 reworded the old "is missing sprints/..." one)', async () => {
    const r = await loadPlan(asFetch({ sprints: [] }))
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('is not a plan v2 (planFormat 2)') })
  })
  it.each([
    ['tasks', (p: Record<string, unknown>) => { delete p.tasks }],
    ['design_bank', (p: Record<string, unknown>) => { delete p.design_bank }],
    ['a ticket links', (p: Record<string, unknown>) => { delete (p.tickets as Record<string, unknown>[])[0].links }],
  ])('does not throw on a v2 plan missing %s', async (_n, strip) => {
    const p = JSON.parse(JSON.stringify(flatPlanV2))
    strip(p)
    const r = await loadPlan(asFetch(p))
    expect(typeof r.ok).toBe('boolean')
  })
  it('resolves {{learner.*}} links in a v2 plan', async () => {
    const p = JSON.parse(JSON.stringify(flatPlanV2))
    p.tickets[0].links = [{ label: 'mine', url: '{{learner.patternsRepo}}' }]
    p.learner = { patternsRepo: 'https://example.com/me' }
    const r = await loadPlan(asFetch(p))
    expect(r.ok && r.v2.tickets[0].links).toEqual([{ label: 'mine', url: 'https://example.com/me' }])
    delete p.learner
    const r2 = await loadPlan(asFetch(p))
    expect(r2.ok && r2.v2.tickets[0].links).toEqual([])
  })
})

describe('runReconcile with a v2 plan', () => {
  it('seeds ten tickets with lanes, the plan version and the possible XP', async () => {
    const d = freshDb()
    await runReconcile(d, flatPlanV2)
    expect(await d.tickets.count()).toBe(10)
    expect((await d.tickets.get('m1w2t1'))!).toMatchObject({ lane: 'path', kind: 'build', status: 'todo', xp: 0, archived: false })
    expect(await getSettings(d)).toMatchObject({ planVersion: 'fx-v2-1', possibleXp: 130 })
  })
})

describe('usePlanV2', () => {
  const wrap = (planV2: typeof flatPlanV2 | null) =>
    ({ children }: { children: React.ReactNode }) => <AppProviders db={freshDb()} plan={flatPlanV2} planV2={planV2}>{children}</AppProviders>
  it('returns the v2 plan it was given', () => {
    const { result } = renderHook(() => usePlanV2(), { wrapper: wrap(flatPlanV2) })
    expect(result.current).toBe(flatPlanV2)
  })
  it('is null when no plan v2 is handed over', () => {
    const { result } = renderHook(() => usePlanV2(), { wrapper: wrap(null) })
    expect(result.current).toBeNull()
  })
})

describe('the kept screens mount on a loaded plan', () => {
  function Where() { return <div data-testid="where">{useLocation().pathname}</div> }
  it.each(['/', '/path', '/skills', '/review', '/settings', '/guide', '/dsa', '/designs', '/atlas', '/banks'])('%s renders without throwing', async to => {
    setNow(() => new Date('2026-11-04T10:00:00+05:30').getTime())
    const d = freshDb()
    await runReconcile(d, flatPlanV2)
    await patchSettings(d, { startDate: '2026-09-07' })
    const { container } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={[to]}>
        <AppProviders db={d} plan={flatPlanV2} planV2={flatPlanV2}><AppRoutes /><Where /></AppProviders>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('where').textContent).toBe(to)
    // `Loading` prints its text only after 300 ms, so wait for the screen's own ready root instead
    await waitFor(() => expect(container.querySelector('[data-testid^="screen-"][data-ready="true"]')).not.toBeNull(), { timeout: 5000 })
    expect(screen.queryByText(/Invalid date/)).toBeNull()
  })
})

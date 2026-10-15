import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { patchSettings } from '../../src/data/db'
import { runReconcile } from '../../src/data/seed'
import { usePace, usePlanChanged, useQueue, useTodayModel } from '../../src/data/flatHooks'
import { setNow } from '../../src/lib/clock'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'

beforeEach(() => { try { localStorage.removeItem('dojo.planChangeSeen') } catch { /* no storage */ } })

async function setup() {
  setNow(() => new Date(2026, 10, 4, 10, 0).getTime()) // Wednesday, 60 minutes
  const d = freshDb()
  await runReconcile(d, flatPlanV2)
  const wrapper = ({ children }: { children: ReactNode }) => <AppProviders db={d} plan={flatPlanV2} planV2={flatPlanV2}>{children}</AppProviders>
  return { d, wrapper }
}

describe('useTodayModel', () => {
  it('derives the day from tickets, settings and the plan (TODAY-07)', async () => {
    const { wrapper } = await setup()
    const { result } = renderHook(() => useTodayModel(), { wrapper })
    await waitFor(() => expect(result.current).toBeDefined())
    expect(result.current!.mix.budget).toBe(60)
    expect(result.current!.next).toMatchObject({ kind: 'start', reason: 'next in your queue, about 45 min' })
    expect(result.current!.careerLane).toBe(false)
    expect(result.current!.pathNote).toBeNull()
  })
  it('leaves the quest ticket out of the pick list (TODAY-16)', async () => {
    const { wrapper } = await setup()
    const { result } = renderHook(() => useTodayModel(), { wrapper })
    await waitFor(() => expect(result.current).toBeDefined())
    const next = result.current!.next
    expect(next.kind).toBe('start')
    const questId = (next as { ticket: { id: string } }).ticket.id
    const listed = [...result.current!.pick.doing, ...result.current!.pick.lanes.flatMap(l => l.items)].map(t => t.id)
    expect(listed).not.toContain(questId)
  })
  it('follows a budget override and the career switch', async () => {
    const { d, wrapper } = await setup()
    await patchSettings(d, { laneBudgets: [90, 60, 60, 15, 30, 30, 150], careerLane: true })
    const { result } = renderHook(() => useTodayModel(), { wrapper })
    await waitFor(() => expect(result.current?.mix.budget).toBe(15))
    expect(result.current!.careerLane).toBe(true)
  })
})

describe('useQueue and usePace', () => {
  it('returns Path groups and chips', async () => {
    const { wrapper } = await setup()
    const { result } = renderHook(() => useQueue({ lane: 'dsa' }), { wrapper })
    await waitFor(() => expect(result.current).toBeDefined())
    expect(result.current!.view.upNext.map(l => l.lane)).toEqual(['dsa'])
    expect(result.current!.chips.map(c => c.lane)).toEqual(['all', 'path', 'dsa', 'design'])
  })
  it('returns the pace line', async () => {
    const { wrapper } = await setup()
    const { result } = renderHook(() => usePace(), { wrapper })
    await waitFor(() => expect(result.current).toBeDefined())
    expect(result.current!.line).toMatch(/^at this pace the plan ends about [A-Z][a-z]+ \d{4}$/)
    expect(result.current!.budgets).toEqual([90, 60, 60, 60, 30, 30, 150])
  })
})

describe('usePlanChanged (SHELL-24)', () => {
  it('shows once per browser, not again after a reload or a dismiss, and writes nothing', async () => {
    const { d, wrapper } = await setup()
    await d.events.add({ t: 'replan', at: 777, report: { backupFile: null, archived: 1, doneAndDropped: [], xpBefore: 5, xpAfter: 5, designSessionsRewritten: 0, coreMinutesBefore: 1440, coreMinutesAfter: 960, codeMerged: 0 } })
    const before = await d.events.count()
    const first = renderHook(() => usePlanChanged(), { wrapper })
    await waitFor(() => expect(first.result.current.visible).toBe(true))
    act(() => first.result.current.dismiss())
    expect(first.result.current.visible).toBe(false)
    const second = renderHook(() => usePlanChanged(), { wrapper })
    await waitFor(() => expect(second.result.current.event).not.toBeNull())
    expect(second.result.current.visible).toBe(false)
    expect(await d.events.count()).toBe(before)
  })
  it('has nothing to show without a replan event', async () => {
    const { wrapper } = await setup()
    const { result } = renderHook(() => usePlanChanged(), { wrapper })
    await new Promise(r => setTimeout(r, 30))
    expect(result.current).toMatchObject({ event: null, visible: false })
  })
})

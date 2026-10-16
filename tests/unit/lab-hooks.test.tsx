import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DbProvider } from '../../src/data/dbContext'
import { resetLabInfoCache, useAllCheckAttempts, useAllLabRuns, useLabInfos, useLabReviews, useLabRow, useLabRuns } from '../../src/data/labHooks'
import { useLabTicket } from '../../src/screens/do/kinds/useLabTicket'
import { freshDb } from '../helpers/db'
import { INFO } from '../helpers/labServer'
import { mkLabRow, mkReview, mkRun } from '../helpers/labRows'
import { mkTicket } from '../helpers/planV2'

const act = vi.hoisted(() => ({ fetchLabInfo: vi.fn() }))
vi.mock('../../src/data/labActions', () => act)
const ro = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))

beforeEach(() => { resetLabInfoCache(); act.fetchLabInfo.mockReset(); ro.on = false })
const wrap = (d: ReturnType<typeof freshDb>) => ({ children }: { children: ReactNode }) => <DbProvider db={d}>{children}</DbProvider>

describe('labHooks', () => {
  it('reads the lab row, its runs oldest first, all runs, all reviews and all check attempts', async () => {
    const d = freshDb()
    await d.labs.put(mkLabRow('u1'))
    await d.labRuns.bulkPut([mkRun('u1', 20, { a: 'fail' }), mkRun('u1', 10, { a: 'pass' }), mkRun('other', 5, { a: 'pass' })])
    await d.labReviews.put(mkReview('u1', 30, true))
    await d.checkAttempts.put({ id: 'ca1', ticketId: 't', at: 1, answers: [], feedback: [], passed: true })
    const w = wrap(d)
    const row = renderHook(() => useLabRow('u1'), { wrapper: w })
    await waitFor(() => expect(row.result.current?.labId).toBe('u1'))
    const runs = renderHook(() => useLabRuns('u1'), { wrapper: w })
    await waitFor(() => expect(runs.result.current?.map(r => r.at)).toEqual([10, 20]))
    const allRuns = renderHook(() => useAllLabRuns(), { wrapper: w })
    await waitFor(() => expect(allRuns.result.current).toHaveLength(3))
    const reviews = renderHook(() => useLabReviews(), { wrapper: w })
    await waitFor(() => expect(reviews.result.current).toHaveLength(1))
    const attempts = renderHook(() => useAllCheckAttempts(), { wrapper: w })
    await waitFor(() => expect(attempts.result.current).toHaveLength(1))
  })
  it('gives null for a lab that was never set up and an empty list for an empty id', async () => {
    const d = freshDb()
    const row = renderHook(() => useLabRow('u1'), { wrapper: wrap(d) })
    await waitFor(() => expect(row.result.current).toBeNull())
    const none = renderHook(() => useLabRuns(''), { wrapper: wrap(d) })
    await waitFor(() => expect(none.result.current).toEqual([]))
  })
})

describe('useLabInfos', () => {
  it('loads each lab once, keeps only the labs that exist, and caches', async () => {
    act.fetchLabInfo.mockImplementation(async (id: string) => (id === 'u1' ? { ...INFO, title: 'U1' } : null))
    const d = freshDb()
    const a = renderHook(() => useLabInfos(['u1', 'gone', 'u1']), { wrapper: wrap(d) })
    expect(a.result.current).toBeUndefined()
    await waitFor(() => expect(Object.keys(a.result.current ?? {})).toEqual(['u1']))
    const b = renderHook(() => useLabInfos(['u1']), { wrapper: wrap(d) })
    await waitFor(() => expect(b.result.current?.u1.title).toBe('U1'))
    expect(act.fetchLabInfo.mock.calls.filter(c => c[0] === 'u1')).toHaveLength(1)
  })
  it('settles to an empty set when nothing is asked or the server is unreachable', async () => {
    act.fetchLabInfo.mockRejectedValue(new Error('down'))
    const none = renderHook(() => useLabInfos([]), { wrapper: wrap(freshDb()) })
    await waitFor(() => expect(none.result.current).toEqual({}))
    const down = renderHook(() => useLabInfos(['u1']), { wrapper: wrap(freshDb()) })
    await waitFor(() => expect(down.result.current).toEqual({}))
  })
})

describe('useLabTicket', () => {
  const build = mkTicket({ id: 'tlab.build.1', kind: 'build', lab: { id: 't-lab', gpu: 'none' } })
  it('is null for a ticket with no lab', () => {
    const r = renderHook(() => useLabTicket(mkTicket({ id: 'w', kind: 'watch' })), { wrapper: wrap(freshDb()) })
    expect(r.result.current).toBeNull()
  })
  it('is loading and locked, then not-set-up, gated and locked until the milestone passes', async () => {
    act.fetchLabInfo.mockResolvedValue(INFO)
    const d = freshDb()
    const r = renderHook(() => useLabTicket(build), { wrapper: wrap(d) })
    expect(r.result.current).toMatchObject({ state: 'loading', doneLocked: true })
    await waitFor(() => expect(r.result.current?.state).toBe('not-set-up'))
    expect(r.result.current).toMatchObject({ gated: true, passed: false, doneLocked: true, allPassed: false })
    await d.labs.put(mkLabRow('t-lab'))
    await waitFor(() => expect(r.result.current?.state).toBe('set-up'))
    await d.labRuns.put(mkRun('t-lab', 1, { c1: 'pass' }))
    await waitFor(() => expect(r.result.current).toMatchObject({ passed: true, doneLocked: false, allPassed: false }))
    await d.labRuns.put(mkRun('t-lab', 2, { c2: 'pass', c3: 'pass' }))
    await waitFor(() => expect(r.result.current?.allPassed).toBe(true))
  })
  it('is missing, and not gated, when the server does not know the lab', async () => {
    act.fetchLabInfo.mockResolvedValue(null)
    const r = renderHook(() => useLabTicket(build), { wrapper: wrap(freshDb()) })
    await waitFor(() => expect(r.result.current?.state).toBe('missing'))
    expect(r.result.current).toMatchObject({ info: null, gated: false, doneLocked: false })
  })
  it('in a read-only browser the definition is out of reach: the block follows the stored row and nothing is gated', async () => {
    ro.on = true
    act.fetchLabInfo.mockResolvedValue(null)
    const d = freshDb()
    await d.labs.put(mkLabRow('t-lab'))
    const r = renderHook(() => useLabTicket(build), { wrapper: wrap(d) })
    await waitFor(() => expect(r.result.current?.state).toBe('set-up'))
    expect(r.result.current).toMatchObject({ gated: false, doneLocked: false, allPassed: false })
  })
  it('is not gated when the lab has no milestone for this ticket', async () => {
    act.fetchLabInfo.mockResolvedValue(INFO)
    const r = renderHook(() => useLabTicket(mkTicket({ id: 'other', kind: 'build', lab: { id: 't-lab', gpu: 'none' } })), { wrapper: wrap(freshDb()) })
    await waitFor(() => expect(r.result.current?.state).toBe('not-set-up'))
    expect(r.result.current).toMatchObject({ gated: false, doneLocked: false })
  })
  it('hands over the lab review rows of its own lab only', async () => {
    act.fetchLabInfo.mockResolvedValue(INFO)
    const d = freshDb()
    await d.labReviews.bulkPut([mkReview('t-lab', 1, false), mkReview('other', 2, true)])
    const r = renderHook(() => useLabTicket(build), { wrapper: wrap(d) })
    await waitFor(() => expect(r.result.current?.reviews.map(x => x.labId)).toEqual(['t-lab']))
  })
})

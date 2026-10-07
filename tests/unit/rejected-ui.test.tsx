import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RejectedChanges } from '../../src/screens/RejectedChanges'
import { registerSyncControls, setRejectedCount, syncControls } from '../../src/data/sync/status'
import { Backups } from '../../src/screens/Backups'
import { ToastProvider } from '../../src/ui/primitives'

const parked = [
  { opId: 'o1', tbl: 'tickets', op: 'put' as const, id: 'p1', at: '2026-09-29T10:00:00.000Z', error: 'HTTP 413' },
  { opId: 'o2', tbl: 'events', op: 'delete' as const, id: 'c:4', at: '2026-09-29T10:00:01.000Z', error: 'HTTP 400' },
]
const base = { ...syncControls }
afterEach(() => { registerSyncControls(base); setRejectedCount(0) })

/** Addendum 5: each backup row's button is named exactly "Restore"; find it within that row. */
const restoreIn = (file: string) => within(screen.getByText(file).closest('li')!).getByRole('button', { name: 'Restore' })

describe('I2: Settings lists changes that could not be saved', () => {
  it('lists them and Retry sends them again', async () => {
    const retry = vi.fn(async () => true)
    registerSyncControls({ ...base, listRejected: async () => parked, retryRejected: retry })
    setRejectedCount(2)
    render(<ToastProvider><RejectedChanges /></ToastProvider>)
    const region = await screen.findByRole('region', { name: "Changes that couldn't be saved" })
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(2))
    expect(within(region).getByText(/tickets · put · p1/)).toBeInTheDocument()
    expect(within(region).getByText(/HTTP 413/)).toBeInTheDocument()
    fireEvent.click(within(region).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(retry).toHaveBeenCalled())
  })

  it('renders nothing when there are none', async () => {
    registerSyncControls({ ...base, listRejected: async () => [] })
    render(<ToastProvider><RejectedChanges /></ToastProvider>)
    await new Promise(r => setTimeout(r, 10))
    expect(screen.queryByRole('region', { name: "Changes that couldn't be saved" })).toBeNull()
  })
})

describe('I2: restore is blocked while changes are parked', () => {
  it('does not call /db/restore', async () => {
    setRejectedCount(1)
    const calls: string[] = []
    const fetcher = (async (u: RequestInfo | URL, i?: RequestInit) => {
      calls.push(`${i?.method ?? 'GET'} ${String(u)}`)
      return new Response(JSON.stringify({ backups: [{ file: 'dojo-2026-09-29.db', bytes: 1, at: '2026-09-29T00:00:00.000Z' }] }))
    }) as typeof fetch
    const reload = vi.fn()
    render(<ToastProvider><Backups fetcher={fetcher} reload={reload} /></ToastProvider>)
    fireEvent.click((await screen.findByText('dojo-2026-09-29.db'), restoreIn('dojo-2026-09-29.db')))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText(/couldn't be saved/)).toBeInTheDocument()
    expect(calls).not.toContain('POST /db/restore')
    expect(reload).not.toHaveBeenCalled()
  })
})

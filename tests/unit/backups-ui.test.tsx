import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Backups } from '../../src/screens/Backups'
import { registerSyncControls } from '../../src/data/sync/status'
import { syncGate } from '../../src/data/db'
import { ToastProvider } from '../../src/ui/primitives'

const files = [
  { file: 'dojo-2026-09-29-101010.db', bytes: 20480, at: '2026-09-29T10:10:10.000Z' },
  { file: 'dojo-2026-09-29.db', bytes: 10240, at: '2026-09-29T08:00:00.000Z' },
]
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })

function setup(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = []
  const fetcher = (async (u: RequestInfo | URL, i?: RequestInit) => { calls.push(`${i?.method ?? 'GET'} ${String(u)}`); return handler(String(u), i) }) as typeof fetch
  const reload = vi.fn()
  render(<ToastProvider><Backups fetcher={fetcher} reload={reload} /></ToastProvider>)
  return { calls, reload }
}

/** Addendum 5: each backup row's button is named exactly "Restore"; find it within that row. */
const restoreIn = (file: string) => within(screen.getByText(file).closest('li')!).getByRole('button', { name: 'Restore' })

describe('Backups region', () => {
  it('lists backups with file names inside a region named Backups', async () => {
    setup(() => json({ backups: files }))
    const region = screen.getByRole('region', { name: 'Backups' })
    await waitFor(() => expect(within(region).getAllByRole('listitem')).toHaveLength(2))
    expect(within(region).getByText('dojo-2026-09-29.db')).toBeInTheDocument()
    expect(within(region).getByRole('button', { name: 'Back up now' })).toBeInTheDocument()
  })

  it('Back up now posts and reloads the list', async () => {
    const { calls } = setup((u, i) => (i?.method === 'POST' ? json({ ok: true, file: 'x.db' }) : json({ backups: files })))
    await screen.findByText('dojo-2026-09-29.db')
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }))
    await waitFor(() => expect(calls.filter(c => c === 'GET /db/backups')).toHaveLength(2))
    expect(calls).toContain('POST /db/backup')
  })

  it('Restore asks for confirmation, flushes and wipes, then reloads', async () => {
    const order: string[] = []
    registerSyncControls({ flush: async () => true, beginRestore: async () => { order.push('flush'); return async () => {} }, wipeLocal: async () => { order.push('wipe') } })
    const { calls, reload } = setup((u, i) => (i?.method === 'POST' ? (order.push('restore'), json({ ok: true })) : json({ backups: files })))
    await screen.findByText('dojo-2026-09-29.db')
    fireEvent.click(restoreIn('dojo-2026-09-29.db'))
    const dlg = screen.getByRole('dialog', { name: 'Restore this backup?' })
    expect(calls).not.toContain('POST /db/restore')
    fireEvent.click(within(dlg).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(order).toEqual(['flush', 'restore', 'wipe'])
  })

  it('UAT cu-8 P3-2: the pre-restore row reads as "Before restore" with the local time, the file name in its tooltip', async () => {
    const pre = { file: 'pre-restore-2026-10-06T13-56-43-830Z.db', bytes: 20480, at: '2026-10-06T13:56:43.830Z' }
    setup(() => json({ backups: [pre, ...files] }))
    const name = await screen.findByText('Before restore')
    expect(name).toHaveAttribute('title', pre.file)
    const row = name.closest('li')!
    expect(row.textContent).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/)
    expect(row.textContent).not.toContain('T13-56-43')
    fireEvent.click(within(row).getByRole('button', { name: 'Restore' }))
    expect(within(screen.getByRole('dialog')).getByText(/^Before restore · \d{4}-/)).toBeInTheDocument()
  })

  it('UAT cu-8 P3-4: Back up now says Backup saved, and a restore leaves a line for the page that comes back', async () => {
    sessionStorage.removeItem('dojo.restoredToast')
    const order: string[] = []
    registerSyncControls({ flush: async () => true, beginRestore: async () => async () => {}, wipeLocal: async () => { order.push('wipe') } })
    const { reload } = setup((u, i) => (i?.method === 'POST' ? json({ ok: true }) : json({ backups: files })))
    await screen.findByText('dojo-2026-09-29.db')
    fireEvent.click(screen.getByRole('button', { name: 'Back up now' }))
    expect(await screen.findByText('Backup saved')).toBeInTheDocument()
    fireEvent.click(restoreIn('dojo-2026-09-29.db'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(reload).toHaveBeenCalled())
    expect(sessionStorage.getItem('dojo.restoredToast')).toMatch(/^Restored dojo-2026-09-29\.db · \d{4}-\d{2}-\d{2} \d{2}:\d{2}\./)
    // the page that comes back shows it once
    cleanup()
    setup(() => json({ backups: files }))
    expect(await screen.findByText(/^Restored dojo-2026-09-29\.db/)).toBeInTheDocument()
    expect(sessionStorage.getItem('dojo.restoredToast')).toBeNull()
  })

  it('I4: aborts the restore when pending changes could not be flushed', async () => {
    const order: string[] = []
    registerSyncControls({ flush: async () => true, beginRestore: async () => { order.push('flush'); return null }, wipeLocal: async () => { order.push('wipe') } })
    const { calls, reload } = setup((u, i) => (i?.method === 'POST' ? json({ ok: true }) : json({ backups: files })))
    await screen.findByText('dojo-2026-09-29.db')
    fireEvent.click(restoreIn('dojo-2026-09-29.db'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText(/not saved to disk yet/i)).toBeInTheDocument()
    expect(order).toEqual(['flush'])
    expect(calls).not.toContain('POST /db/restore')
    expect(reload).not.toHaveBeenCalled()
  })

  it('a wipe that fails after the restore keeps sync paused and asks for a reload', async () => {
    let cancelled = false
    registerSyncControls({
      flush: async () => true,
      beginRestore: async () => async () => { cancelled = true },
      wipeLocal: async () => { throw new Error('blocked') },
    })
    const { reload } = setup((u, i) => (i?.method === 'POST' ? json({ ok: true }) : json({ backups: files })))
    await screen.findByText('dojo-2026-09-29.db')
    fireEvent.click(restoreIn('dojo-2026-09-29.db'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText(/Reload to finish restore/)).toBeInTheDocument()
    expect(reload).not.toHaveBeenCalled()
    expect(cancelled).toBe(false)
  })

  it('a refused restore cancels the pause', async () => {
    let cancelled = false
    registerSyncControls({ flush: async () => true, beginRestore: async () => async () => { cancelled = true }, wipeLocal: async () => {} })
    const { reload } = setup((u, i) => (i?.method === 'POST' ? json({ ok: false }, 400) : json({ backups: files })))
    await screen.findByText('dojo-2026-09-29.db')
    fireEvent.click(restoreIn('dojo-2026-09-29.db'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText('Restore failed')).toBeInTheDocument()
    expect(cancelled).toBe(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('Minor 2: a network error keeps the restore flag (the next boot decides) and asks for a reload', async () => {
    let cancelled = false
    registerSyncControls({ flush: async () => true, beginRestore: async () => async () => { cancelled = true }, wipeLocal: async () => {} })
    const { reload } = setup((u, i) => { if (i?.method === 'POST') throw new TypeError('Failed to fetch'); return json({ backups: files }) })
    await screen.findByText('dojo-2026-09-29.db')
    fireEvent.click(restoreIn('dojo-2026-09-29.db'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))
    expect(await screen.findByText(/Reload/)).toBeInTheDocument()
    expect(cancelled).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('Addendum 3: in a read-only browser, Back up now and Restore refuse with the Read-only message', async () => {
    syncGate.readOnly = true
    try {
      const { calls } = setup(() => json({ backups: files }))
      await screen.findByText('dojo-2026-09-29.db')
      fireEvent.click(screen.getByRole('button', { name: 'Back up now' }))
      expect(await screen.findByText(/^Read-only/)).toBeInTheDocument()
      fireEvent.click(restoreIn('dojo-2026-09-29.db'))
      expect(screen.queryByRole('dialog')).toBeNull() // Addendum 9: the toast straight away, no confirm dialog
      await waitFor(() => expect(screen.getAllByText(/^Read-only/).length).toBeGreaterThanOrEqual(2))
      expect(calls.filter(c => c.startsWith('POST'))).toEqual([])
    } finally {
      syncGate.readOnly = false
    }
  })

  it('Cancel closes the dialog without restoring', async () => {
    const { calls } = setup(() => json({ backups: files }))
    await screen.findByText('dojo-2026-09-29.db')
    fireEvent.click(restoreIn('dojo-2026-09-29.db'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.some(c => c.includes('restore'))).toBe(false)
  })

  it('explains how to start Dojo when the server is unreachable', async () => {
    setup(() => { throw new TypeError('down') })
    expect(await screen.findByTestId('backups-down')).toHaveTextContent(/Dock/)
  })
})

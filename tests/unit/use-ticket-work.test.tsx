import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '../../src/data/types'
import { AUTOSAVE_MS, useTicketWork } from '../../src/study/useTicketWork'
import { freshDb } from '../helpers/db'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const ro = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))
afterEach(() => { ro.on = false })

const t1 = mkTicket({ id: 't1', kind: 'watch', explain: ['Q1?', 'Q2?'], explainAnswers: ['A1', 'A2'] })
function Harness({ ticket }: { ticket: Ticket }) {
  const w = useTicketWork(ticket)
  return (
    <div>
      <textarea data-testid="n" value={w.notes} onChange={e => w.setNotes(e.target.value)} />
      <input data-testid="a2" value={w.answers[1]} onChange={e => w.setAnswer(1, e.target.value)} />
      <input type="checkbox" data-testid="m" checked={w.selfMark === 'done'} onChange={e => w.setSelfMark(e.target.checked ? 'done' : undefined)} />
      <button type="button" data-testid="flush" onClick={() => void w.flush()}>flush</button>
      <span data-testid="count">{w.answers.length}</span>
    </div>
  )
}
async function setup(extra: Partial<Ticket> = {}) {
  const d = freshDb()
  const t = { ...t1, ...extra }
  await d.tickets.put(t)
  renderWithApp(<Harness ticket={t} />, { db: d, ...appPlans() })
  return d
}
const row = async (d: Awaited<ReturnType<typeof setup>>) => (await d.tickets.get('t1'))!

describe('useTicketWork', () => {
  it('starts from what the ticket row already holds, one answer slot per question', async () => {
    await setup({ learnerNotes: 'earlier', explainResponses: ['x'] })
    expect(screen.getByTestId('n')).toHaveValue('earlier')
    expect(screen.getByTestId('count')).toHaveTextContent('2')
    expect(screen.getByTestId('a2')).toHaveValue('')
  })

  it('shows what is typed at once and writes nothing until the pause, then writes once', async () => {
    const d = await setup()
    fireEvent.change(screen.getByTestId('n'), { target: { value: 'layers' } })
    fireEvent.change(screen.getByTestId('n'), { target: { value: 'layers and weights' } })
    expect(screen.getByTestId('n')).toHaveValue('layers and weights')
    expect((await row(d)).learnerNotes).toBeUndefined()
    await waitFor(async () => expect((await row(d)).learnerNotes).toBe('layers and weights'), { timeout: AUTOSAVE_MS + 2500 })
  })

  it('saves an explain answer at its index and the self-mark, and clears the mark', async () => {
    const d = await setup({ explainResponses: ['keep me', ''] })
    fireEvent.change(screen.getByTestId('a2'), { target: { value: 'it nudges them' } })
    fireEvent.click(screen.getByTestId('m'))
    fireEvent.click(screen.getByTestId('flush'))
    await waitFor(async () => expect(await row(d)).toMatchObject({ explainResponses: ['keep me', 'it nudges them'], selfMark: 'done' }))
    fireEvent.click(screen.getByTestId('m'))
    await waitFor(async () => expect((await row(d)).selfMark).toBeUndefined())
  })

  it('flush writes a pending draft at once, and leaving the screen flushes too', async () => {
    const d = await setup()
    fireEvent.change(screen.getByTestId('n'), { target: { value: 'quick' } })
    fireEvent.click(screen.getByTestId('flush'))
    await waitFor(async () => expect((await row(d)).learnerNotes).toBe('quick'))
    fireEvent.change(screen.getByTestId('n'), { target: { value: 'quick, then left' } })
    cleanup()
    await waitFor(async () => expect((await row(d)).learnerNotes).toBe('quick, then left'))
  })

  it('writes the draft at once when the page is going away (reload right after typing)', async () => {
    const d = await setup()
    fireEvent.change(screen.getByTestId('n'), { target: { value: 'typed, then reloaded' } })
    window.dispatchEvent(new Event('pagehide'))
    await waitFor(async () => expect((await row(d)).learnerNotes).toBe('typed, then reloaded'), { timeout: 500 })
  })

  it('writes the draft when the tab is hidden', async () => {
    const d = await setup()
    fireEvent.change(screen.getByTestId('a2'), { target: { value: 'hidden tab' } })
    const was = Object.getOwnPropertyDescriptor(document, 'visibilityState')
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try {
      document.dispatchEvent(new Event('visibilitychange'))
      await waitFor(async () => expect((await row(d)).explainResponses).toEqual(['', 'hidden tab']), { timeout: 500 })
    } finally {
      if (was) Object.defineProperty(document, 'visibilityState', was); else delete (document as unknown as Record<string, unknown>).visibilityState
    }
  })

  it('writes nothing in a read-only browser', async () => {
    ro.on = true
    const d = await setup()
    fireEvent.change(screen.getByTestId('n'), { target: { value: 'nope' } })
    fireEvent.click(screen.getByTestId('flush'))
    await new Promise(r => setTimeout(r, AUTOSAVE_MS + 300))
    expect((await row(d)).learnerNotes).toBeUndefined()
  })

  it('clears the mark with null in the data (ruling R5)', async () => {
    const d = await setup({ selfMark: 'done' })
    expect(screen.getByTestId('m')).toBeChecked()
    fireEvent.click(screen.getByTestId('m'))
    await waitFor(async () => expect((await row(d)).selfMark).toBeUndefined())
    expect(screen.getByTestId('m')).not.toBeChecked()
  })

  it('keeps nothing about the ticket in browser storage', async () => {
    const d = await setup()
    fireEvent.change(screen.getByTestId('n'), { target: { value: 'db only' } })
    fireEvent.click(screen.getByTestId('flush'))
    await waitFor(async () => expect((await row(d)).learnerNotes).toBe('db only'))
    expect(Object.keys(localStorage).filter(k => k.includes('ticket'))).toEqual([])
  })

  it('toasts a refusal (an oversized note) and keeps it pending instead of dropping it', async () => {
    const d = await setup()
    fireEvent.change(screen.getByTestId('n'), { target: { value: 'z'.repeat(20_001) } })
    fireEvent.click(screen.getByTestId('flush'))
    expect(await screen.findByText('Notes can be at most 20000 characters')).toBeInTheDocument()
    expect((await row(d)).learnerNotes).toBeUndefined()
    // the draft is still pending: a shorter text replaces it and is written by the next flush
    fireEvent.change(screen.getByTestId('n'), { target: { value: 'short again' } })
    fireEvent.click(screen.getByTestId('flush'))
    await waitFor(async () => expect((await row(d)).learnerNotes).toBe('short again'))
  })

  it('toasts a write that throws, never rejects the flush, and puts the mark back when it could not be saved', async () => {
    const d = await setup()
    const put = vi.spyOn(d.tickets, 'put').mockRejectedValue(new Error('disk gone'))
    fireEvent.change(screen.getByTestId('n'), { target: { value: 'will not stick' } })
    fireEvent.click(screen.getByTestId('flush'))
    expect(await screen.findByText('Could not save your work. Try again.')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('m'))
    await waitFor(() => expect(screen.getByTestId('m')).not.toBeChecked())
    put.mockRestore()
    fireEvent.click(screen.getByTestId('flush'))
    await waitFor(async () => expect((await row(d)).learnerNotes).toBe('will not stick'))
  })
})

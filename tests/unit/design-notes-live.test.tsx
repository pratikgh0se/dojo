import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { lockDesignSession, startDesignSession } from '../../src/data/designSessionActions'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const ist = (s: string) => new Date(`${s}+05:30`).getTime()
const T = ist('2026-10-11T10:00:00')
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
const tid = (id: string) => screen.getByTestId(id)

async function open(opts: { at?: number; startedAt?: number; lock?: boolean } = {}) {
  const at = opts.at ?? T
  setNow(() => at)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode: 'solo', deepDives: DIVES, nowMs: opts.startedAt ?? T - 10 * MIN })
  const id = typeof s === 'string' ? s : (s as { id: string }).id
  if (opts.lock) await lockDesignSession(d, id, at)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method', path: '/designs/session/:designId' })
  return { d, id }
}
const notesOf = async (d: Awaited<ReturnType<typeof open>>['d'], id: string) => (await d.designSessions.get(id))!.notes

describe('notes panel in the live session', () => {
  it('shows the six sections and the autosave line while drawing', async () => {
    await open()
    await screen.findByTestId('notes-panel')
    expect(tid('notes-panel')).toHaveAttribute('data-no-global-keys')
    expect(tid('session-autosave')).toHaveTextContent('Autosave on')
  })

  it('writes every change at once (no debounce) and then says Autosaved', async () => {
    const { d, id } = await open()
    fireEvent.change(await screen.findByTestId('notes-field-open'), { target: { value: 'What breaks at 10x?' } })
    await waitFor(async () => expect((await notesOf(d, id))?.open).toBe('What breaks at 10x?'))
    await waitFor(() => expect(tid('session-autosave')).toHaveTextContent(/^Autosaved /))
  })

  it('typing letters and digits in a notes box adds nothing to the canvas and never cancels a key', async () => {
    const { d, id } = await open()
    const box = await screen.findByTestId('notes-field-api')
    for (const key of 'nctgl?1234') expect(fireEvent.keyDown(box, { key }), key).toBe(true)
    fireEvent.change(box, { target: { value: 'n c t g l ? 1 2 3 4' } })
    await waitFor(async () => expect((await notesOf(d, id))?.api).toBe('n c t g l ? 1 2 3 4'))
    const s = (await d.designSessions.get(id))!
    expect(s.canvas.nodes).toHaveLength(0)
    expect((s.canvas as { notes?: unknown[] }).notes ?? []).toHaveLength(0)
    expect(tid('session-phase')).toHaveTextContent('Drawing')
  })

  it('Esc in a notes box hands focus back to the canvas', async () => {
    await open()
    const box = await screen.findByTestId('notes-field-api')
    box.focus()
    fireEvent.keyDown(box, { key: 'Escape' })
    expect(tid('kit-canvas')).toHaveFocus()
  })

  it('the last keystroke is flushed before the 45:00 lock', async () => {
    const { d, id } = await open({ at: T, startedAt: T - 44 * MIN - 59_000 })
    const box = await screen.findByTestId('notes-field-tradeoffs')
    fireEvent.change(box, { target: { value: 'chose A over B' } })
    setNow(() => T + 5_000)
    await waitFor(async () => expect((await d.designSessions.get(id))!.phase).toBe('close'), { timeout: 4000 })
    expect((await notesOf(d, id))?.tradeoffs).toBe('chose A over B')
  })

  it('a Table block adds a linked schema table at once; renaming it in the editor renames the block', async () => {
    const { d, id } = await open()
    fireEvent.click(await screen.findByTestId('kit-add-table'))
    await waitFor(async () => expect((await notesOf(d, id))?.schema).toHaveLength(1))
    const sid = (await notesOf(d, id))!.schema[0].id
    expect(within(tid(`schema-table-${sid}`)).getByText('linked to canvas block')).toBeInTheDocument()
    fireEvent.change(tid(`schema-table-name-${sid}`), { target: { value: 'layers' } })
    await waitFor(async () => expect((await d.designSessions.get(id))!.canvas.nodes[0].label).toBe('layers'))
  })

  it('is read-only once the drawing is locked, and still shows the text', async () => {
    const { d, id } = await open({ lock: true })
    await screen.findByTestId('notes-panel')
    expect(tid('notes-field-api')).toHaveAttribute('readonly')
    expect(tid('schema-add-table')).toBeDisabled()
    expect((await d.designSessions.get(id))!.phase).toBe('close')
  })
})

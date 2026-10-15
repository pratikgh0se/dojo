import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { enterScore, lockDesignSession, startDesignSession } from '../../src/data/designSessionActions'
import { setNow } from '../../src/lib/clock'
import { DesignSessionScreen } from '../../src/screens/designSession/DesignSessionScreen'
import { seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const T = new Date('2026-10-11T10:00:00+05:30').getTime()
const MIN = 60_000
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']
type Mode = 'solo' | 'ai-partner' | 'human-partner'
type Db = Awaited<ReturnType<typeof seededDb>>

/** Phase-aware wait: the drawing phase has tabs, close and score replace them (DESIGN-12). */
async function open(mode: Mode, opts: { ageMin?: number; prepare?: (d: Db, id: string) => Promise<void> } = {}) {
  setNow(() => T)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode, deepDives: DIVES, nowMs: T - (opts.ageMin ?? 1) * MIN })
  if (opts.prepare) await opts.prepare(d, s.id)
  renderWithApp(<DesignSessionScreen />, { db: d, plan: flatPlanV2, route: '/designs/session/d-method', path: '/designs/session/:designId' })
  await screen.findByTestId('notes-panel')
  if ((await d.designSessions.get(s.id))!.phase === 'drawing') await screen.findByTestId('session-tabs')
  return { d, id: s.id }
}
const tid = (id: string) => screen.getByTestId(id)

describe('right-column tabs (DESIGN-11)', () => {
  it('ai-partner: Notes, Partner, Deep dives; Notes first and selected', async () => {
    await open('ai-partner')
    const tabs = within(tid('session-tabs')).getAllByRole('tab')
    expect(tabs.map(t => t.textContent)).toEqual(['Notes', 'Partner', 'Deep dives'])
    expect(tid('session-tab-notes')).toHaveAttribute('aria-selected', 'true')
  })
  it('solo has no Partner tab; human-partner has one', async () => {
    await open('solo')
    expect(screen.queryByTestId('session-tab-partner')).toBeNull()
    expect(screen.queryByTestId('session-tabpanel-partner')).toBeNull()
  })
  it('human-partner has the Partner tab', async () => {
    await open('human-partner')
    expect(tid('session-tab-partner')).toBeInTheDocument()
    expect(tid('session-tabpanel-partner')).toBeInTheDocument()
  })
  it('selecting a tab shows its panel only', async () => {
    await open('ai-partner')
    fireEvent.click(tid('session-tab-dives'))
    expect(tid('session-tab-dives')).toHaveAttribute('aria-selected', 'true')
    expect(tid('session-tabpanel-notes')).toHaveAttribute('hidden')
    expect(tid('session-tabpanel-dives')).not.toHaveAttribute('hidden')
    expect(tid('session-dive-1')).toBeVisible()
  })
  it('arrow keys, Home and End move between tabs', async () => {
    await open('ai-partner')
    const list = tid('session-tabs')
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(tid('session-tab-partner')).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(list, { key: 'End' })
    expect(tid('session-tab-dives')).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(list, { key: 'ArrowRight' })
    expect(tid('session-tab-notes')).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    expect(tid('session-tab-dives')).toHaveAttribute('aria-selected', 'true')
  })
  it('the autosave line sits in the footer bar, visible on every tab (F2)', async () => {
    await open('ai-partner')
    expect(within(tid('session-footer')).getByTestId('session-autosave')).toBeInTheDocument()
    expect(within(tid('session-tabpanel-notes')).queryByTestId('session-autosave')).toBeNull()
    expect(within(tid('session-tabpanel-notes')).getByTestId('notes-panel')).toBeInTheDocument()
    fireEvent.click(tid('session-tab-dives'))
    expect(tid('session-autosave')).toBeVisible()
  })
})

describe('rail: phase, actions (DESIGN-06, 17, 74, 80)', () => {
  it('the phase chip shows the capitalised word, data-phase stays lowercase', async () => {
    await open('solo')
    expect(tid('session-phase')).toHaveTextContent(/^Drawing$/)
    expect(tid('session-phase')).toHaveAttribute('data-phase', 'drawing')
    expect(tid('session-phase')).toBeVisible()
  })
  it('the rail keeps Discard; the footer ends with Pause, then the single accent CLOSE · DESIGN, last (F2, DESIGN-74); it carries data-accent and literal upper-case text', async () => {
    await open('ai-partner')
    expect(within(tid('session-rail')).getAllByRole('button').map(b => b.getAttribute('data-testid'))).toEqual(['session-discard'])
    expect(within(tid('session-rail')).queryByTestId('session-close-design')).toBeNull()
    const buttons = within(tid('session-footer')).getAllByRole('button')
    expect(buttons.map(b => b.getAttribute('data-testid'))).toEqual(['session-pause', 'session-close-design'])
    expect(tid('session-close-design')).toHaveTextContent(/^CLOSE · DESIGN$/)
    expect(tid('session-close-design')).toHaveAttribute('data-accent', 'primary')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
  })
  it('CLOSE · DESIGN ends drawing at once, with no confirm dialog (R-F2), and the notes flush first', async () => {
    const { d, id } = await open('solo')
    fireEvent.change(tid('notes-field-api'), { target: { value: 'POST /docs' } })
    fireEvent.click(tid('session-close-design'))
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(tid('session-phase')).toHaveTextContent(/^Close$/))
    expect(tid('session-phase')).toHaveAttribute('data-phase', 'close')
    expect((await d.designSessions.get(id))!.notes!.api).toBe('POST /docs')
    expect(screen.queryByTestId('session-close-design')).toBeNull()
  })
  it('the score phase reads Score', async () => {
    const close = { tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 3 as const, readNext: 'z' }
    await open('solo', { prepare: async (d, id) => { await lockDesignSession(d, id, T); await enterScore(d, id, close) } })
    await screen.findByTestId('session-score')
    expect(tid('session-phase')).toHaveTextContent(/^Score$/)
    expect(tid('session-phase')).toHaveAttribute('data-phase', 'score')
  })
})

describe('notes autosave and lock (DESIGN-15, 17, Review Focus 5)', () => {
  it('a typed note reaches the stored session and the status reads Autosaved', async () => {
    const { d, id } = await open('solo')
    fireEvent.change(tid('notes-field-assumptions'), { target: { value: 'RPS 20000' } })
    await waitFor(async () => expect((await d.designSessions.get(id))!.notes!.assumptions).toBe('RPS 20000'))
    await waitFor(() => expect(tid('session-autosave')).toHaveTextContent(/^Autosaved/))
  })
  it('the 45:00 lock flushes the last note before it locks, then every box is read-only', async () => {
    const { d, id } = await open('solo', { ageMin: 44.99 })
    fireEvent.change(tid('notes-field-open'), { target: { value: 'last words' } })
    setNow(() => T + 2 * MIN)
    await waitFor(async () => expect((await d.designSessions.get(id))!.phase).toBe('close'), { timeout: 4000 })
    expect((await d.designSessions.get(id))!.notes!.open).toBe('last words')
    expect(tid('notes-field-open')).toHaveAttribute('readonly')
  })
  it('Close and Score replace the tabs; the notes stay readable and read-only (DESIGN-12)', async () => {
    await open('solo', { prepare: async (d, id) => { await lockDesignSession(d, id, T) } })
    await screen.findByTestId('session-close')
    expect(screen.queryByTestId('session-tabs')).toBeNull()
    expect(tid('notes-panel')).toBeVisible()
    expect(tid('notes-field-api')).toHaveAttribute('readonly')
  })
  it('the AI partner tab is gone after the lock: no tabs, no Partner tab, the notes stay (DESIGN-12)', async () => {
    await open('ai-partner', { prepare: async (d, id) => { await lockDesignSession(d, id, T) } })
    await screen.findByTestId('session-close')
    expect(screen.queryByTestId('session-tabs')).toBeNull()
    expect(screen.queryByTestId('session-tab-partner')).toBeNull()
    expect(screen.queryByTestId('session-tabpanel-partner')).toBeNull()
    expect(tid('notes-panel')).toBeVisible()
  })
  it('the score phase shows the score form and the same read-only notes', async () => {
    const close = { tradeoff: { chose: 'a', over: 'b', because: 'c' }, breaksAt10x: 'x', dataOwnership: 'y', couldNotAnswer: 3 as const, readNext: 'z' }
    await open('solo', { prepare: async (d, id) => { await lockDesignSession(d, id, T); await enterScore(d, id, close) } })
    await screen.findByTestId('session-score')
    expect(screen.queryByTestId('session-close')).toBeNull()
    expect(screen.queryByTestId('session-tabs')).toBeNull()
    expect(tid('notes-field-api')).toHaveAttribute('readonly')
  })
})

describe('focus swap and keys (DESIGN-42, 44)', () => {
  it('Ctrl+. moves focus from the canvas to the first notes box and back; Esc in a box returns to the canvas', async () => {
    await open('solo')
    tid('kit-canvas').focus()
    fireEvent.keyDown(tid('kit-canvas'), { key: '.', ctrlKey: true })
    await waitFor(() => expect(tid('notes-field-req-fn')).toHaveFocus())
    fireEvent.keyDown(tid('notes-field-req-fn'), { key: '.', ctrlKey: true })
    expect(tid('kit-canvas')).toHaveFocus()
    tid('notes-field-api').focus()
    fireEvent.keyDown(tid('notes-field-api'), { key: 'Escape' })
    expect(tid('kit-canvas')).toHaveFocus()
  })
  it('Cmd+. works too, from the Deep dives tab', async () => {
    await open('solo')
    fireEvent.click(tid('session-tab-dives'))
    tid('kit-canvas').focus()
    fireEvent.keyDown(tid('kit-canvas'), { key: '.', metaKey: true })
    await waitFor(() => expect(tid('notes-field-req-fn')).toHaveFocus())
    expect(tid('session-tab-notes')).toHaveAttribute('aria-selected', 'true')
  })
  it('? on the canvas opens a keys overlay listing the shortcuts; Esc closes it', async () => {
    await open('solo')
    tid('kit-canvas').focus()
    fireEvent.keyDown(tid('kit-canvas'), { key: '?' })
    const keys = await screen.findByTestId('session-keys')
    const rows = within(keys).getAllByRole('term').map(t => t.textContent)
    expect(rows).toEqual(expect.arrayContaining(['N', 'C', 'T', 'G', 'Shift+G', 'Arrows', 'Delete', 'L', 'Ctrl/Cmd+.', 'Esc', 'Ctrl/Cmd+Enter']))
    fireEvent.keyDown(keys, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('session-keys')).toBeNull())
  })
})

describe('linked tables and legacy (Review Focus 1)', () => {
  it('a Table block adds a schema table to the notes at once and the editor marks it linked', async () => {
    const { d, id } = await open('solo')
    fireEvent.click(tid('kit-add-table'))
    await waitFor(async () => expect((await d.designSessions.get(id))!.notes!.schema).toHaveLength(1))
    const sid = (await d.designSessions.get(id))!.notes!.schema[0].id
    expect(within(tid(`schema-table-${sid}`)).getByText('linked to canvas block')).toBeInTheDocument()
    fireEvent.change(tid(`schema-table-name-${sid}`), { target: { value: 'layers' } })
    await waitFor(async () => expect((await d.designSessions.get(id))!.canvas.nodes[0].label).toBe('layers'))
  })
})

describe('a cleared table name at the lock', () => {
  it('takes its id (as leaving the box does) when the 45:00 lock comes first, and the linked block follows', async () => {
    const { d, id } = await open('solo', { ageMin: 44.99 })
    fireEvent.click(tid('kit-add-table'))
    await waitFor(async () => expect((await d.designSessions.get(id))!.notes!.schema).toHaveLength(1))
    const sid = (await d.designSessions.get(id))!.notes!.schema[0].id
    fireEvent.change(tid(`schema-table-name-${sid}`), { target: { value: '' } })
    await waitFor(async () => expect((await d.designSessions.get(id))!.notes!.schema[0].name).toBe(''))
    setNow(() => T + 2 * MIN)
    await waitFor(async () => expect((await d.designSessions.get(id))!.phase).toBe('close'), { timeout: 4000 })
    const row = (await d.designSessions.get(id))!
    expect(row.notes!.schema[0].name).toBe(sid)
    expect(row.canvas.nodes[0].label).toBe(sid)
  })
})

describe('redesign diff (DESIGN-73)', () => {
  const REF = { nodes: [{ id: 'a', kind: 'cache', label: 'Cache' }], links: [] }
  async function redesign(reference: unknown) {
    return open('solo', {
      prepare: async (d, id) => {
        // the live row `open` made is the redesign; the earlier one is a finished session
        const earlier = { ...(await d.designSessions.get(id))!, id: 'ds-earlier', phase: 'done' as const, ...(reference ? { reference } : {}) }
        await d.designSessions.put(earlier as never)
        await d.designSessions.update(id, { redesignOf: 'ds-earlier' })
      },
    })
  }
  it('shows the earlier session diff beside the work when it has a reference', async () => {
    await redesign(REF)
    const diff = await screen.findByTestId('session-diff')
    expect(diff).toBeVisible()
    expect(within(diff).getAllByTestId('session-diff-item').length).toBeGreaterThan(0)
  })
  it('still shows session-diff, one sentence and no items, when the earlier session has no reference', async () => {
    await redesign(null)
    const diff = await screen.findByTestId('session-diff')
    expect(diff).toHaveTextContent('No reference was drawn for this session.')
    expect(within(diff).queryByTestId('session-diff-item')).toBeNull()
  })
  it('a session that is not a redesign has no session-diff', async () => {
    await open('solo')
    expect(screen.queryByTestId('session-diff')).toBeNull()
  })
})

describe('Partner tab of a With someone session (DESIGN-55, 56, F6)', () => {
  afterEach(() => { vi.restoreAllMocks() })
  it('a window that opens leaves the card out of the tab until the toggle is pressed', async () => {
    const spy = vi.spyOn(window, 'open').mockReturnValue({} as Window)
    const { id } = await open('human-partner')
    fireEvent.click(tid('session-tab-partner'))
    fireEvent.click(tid('partner-open-window'))
    expect(spy).toHaveBeenCalledWith(`${window.location.origin}/#/partner/${id}`, `dojo-partner-${id}`, expect.any(String))
    expect(within(tid('partner-tab')).queryByTestId('partner-card')).toBeNull()
    fireEvent.click(tid('partner-toggle'))
    expect(within(tid('session-tabpanel-partner')).getByTestId('partner-card')).toBeInTheDocument()
    fireEvent.click(tid('partner-toggle'))
    expect(screen.queryByTestId('partner-card')).toBeNull()
  })
  it('a blocked window (window.open returns null) shows the card in the tab; the toggle hides and shows it', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    await open('human-partner')
    fireEvent.click(tid('session-tab-partner'))
    expect(screen.queryByTestId('partner-card')).toBeNull()
    fireEvent.click(tid('partner-open-window'))
    expect(within(tid('partner-tab')).getByTestId('partner-card')).toBeInTheDocument()
    fireEvent.click(tid('partner-toggle'))
    expect(screen.queryByTestId('partner-card')).toBeNull()
    fireEvent.click(tid('partner-toggle'))
    expect(within(tid('partner-tab')).getByTestId('partner-card')).toBeInTheDocument()
  })
  it('the inline card is not an accent: the screen keeps exactly one data-accent="primary"', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    await open('human-partner')
    fireEvent.click(tid('session-tab-partner'))
    fireEvent.click(tid('partner-open-window'))
    expect(tid('partner-save')).not.toHaveAttribute('data-accent')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    expect(document.querySelector('[data-accent="primary"]')).toBe(tid('session-close-design'))
  })
  it('saving from the inline card writes the partner scores to the session', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => null)
    const { d, id } = await open('human-partner')
    fireEvent.click(tid('session-tab-partner'))
    fireEvent.click(tid('partner-open-window'))
    fireEvent.click(tid('partner-score-1-3'))
    fireEvent.click(tid('partner-save'))
    await waitFor(() => expect(tid('partner-status')).toHaveTextContent('Saved'))
    expect((await d.designSessions.get(id))!.partner?.scores?.perItem).toEqual([3, null, null, null, null])
  })
})

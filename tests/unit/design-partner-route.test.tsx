import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from '../../src/app/App'
import { patchSettings } from '../../src/data/db'
import { saveNotes, startDesignSession } from '../../src/data/designSessionActions'
import { setNow } from '../../src/lib/clock'
import { emptyNotes } from '../../src/rules/designNotes'
import { parsePartnerHash } from '../../src/screens/designSession/partner/partnerRoute'
import { PartnerWindow } from '../../src/screens/designSession/partner/PartnerWindow'
import { freshDb, seededDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { renderWithApp } from '../helpers/render'

const T = new Date('2026-10-11T10:00:00+05:30').getTime()
const DIVES = ['Requirements', 'API first', 'One deep dive', 'Failure modes']

describe('parsePartnerHash', () => {
  it('reads #/partner/<id> and nothing else', () => {
    expect(parsePartnerHash('#/partner/ds-lq1-abc')).toBe('ds-lq1-abc')
    for (const h of ['', '#', '#/partner/', '#/partner/a/b', '#/other/ds-1', '#writer=abc', '#/partner/ds 1', '#/partner/a?x=1', '#/partner/a#b']) expect(parsePartnerHash(h), h).toBeNull()
  })
  it('accepts any id without a slash, query, hash or space, decoded', () => {
    expect(parsePartnerHash('#/partner/ds.1:x@y')).toBe('ds.1:x@y')
    expect(parsePartnerHash('#/partner/ds%3A1')).toBe('ds:1')
    expect(parsePartnerHash('#/partner/%E0%A4%A')).toBeNull() // malformed escape
    expect(parsePartnerHash('#/partner/a%2Fb')).toBeNull() // an encoded slash is still an extra segment
    expect(parsePartnerHash('#/partner/a%20b')).toBeNull()
  })
})

async function human(mode: 'human-partner' | 'solo' = 'human-partner') {
  setNow(() => T)
  const d = await seededDb()
  const s = await startDesignSession(d, { designId: 'd-method', mode, deepDives: DIVES, nowMs: T - 60_000 })
  return { d, id: s.id }
}
const show = (d: Awaited<ReturnType<typeof seededDb>>, id: string, readOnly = false) =>
  renderWithApp(<PartnerWindow sessionId={id} readOnly={readOnly} />, { db: d, plan: flatPlanV2 })

/** Everything the page itself renders; renderWithApp adds a LocationProbe next to it, which is not the page. */
const page = () => screen.getByTestId('screen-partner')

describe('PartnerWindow (DESIGN-57)', () => {
  afterEach(() => { window.location.hash = '' })
  it('an unknown session shows one sentence in screen-partner and nothing else', async () => {
    const { d } = await human()
    show(d, 'ds-nope')
    const missing = await screen.findByTestId('partner-missing')
    expect(missing).toHaveTextContent(/^That session was not found\.$/)
    expect(page()).toContainElement(missing)
    expect(page().textContent?.trim()).toBe('That session was not found.')
    expect(screen.queryByRole('timer')).toBeNull()
    expect(screen.queryByTestId('partner-card')).toBeNull()
  })
  it('a session that is not With someone reads the same', async () => {
    const { d, id } = await human('solo')
    show(d, id)
    await screen.findByTestId('partner-missing')
    expect(page().textContent?.trim()).toBe('That session was not found.')
    expect(screen.queryByRole('timer')).toBeNull()
  })
  it('shows only the card with the clock; number keys do nothing', async () => {
    const { d, id } = await human()
    const { container } = show(d, id)
    expect(await screen.findByTestId('partner-card')).toBeInTheDocument()
    expect(within(page()).getByRole('timer', { name: 'Time left' })).toBeInTheDocument()
    expect(screen.queryByTestId('partner-missing')).toBeNull()
    expect(container.querySelector('nav, aside, [data-testid="kit-palette"], [data-testid="shell-rail"], [data-testid="shell-tabbar"]')).toBeNull()
    for (const key of ['1', '2', '3', '4']) fireEvent.keyDown(document.body, { key })
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
  })
  it('the card here carries the one accent (it is the whole screen)', async () => {
    const { d, id } = await human()
    show(d, id)
    await screen.findByTestId('partner-card')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    expect(screen.getByTestId('partner-save')).toHaveAttribute('data-accent', 'primary')
  })
})

describe('live sync (DESIGN-61)', () => {
  it('the digest follows the stored session without a reload', async () => {
    const { d, id } = await human()
    show(d, id)
    await screen.findByTestId('partner-card')
    expect(screen.getByTestId('partner-digest')).toHaveTextContent('not written')
    await saveNotes(d, id, { ...emptyNotes(), assumptions: 'RPS 20000' })
    await waitFor(() => expect(screen.getByTestId('partner-digest')).toHaveTextContent('RPS 20000'), { timeout: 3000 })
    const s = (await d.designSessions.get(id))!
    await d.designSessions.put({ ...s, canvas: { ...s.canvas, nodes: [{ id: 'cdn-1', kind: 'cdn', label: 'Edge cache', x: 1, y: 1 }] } })
    await waitFor(() => expect(screen.getByTestId('partner-digest')).toHaveTextContent('Edge cache [cdn]'), { timeout: 3000 })
  })
  it('a session that finishes while the card is open turns read-only without a reload (Review Focus 3)', async () => {
    const { d, id } = await human()
    show(d, id)
    await screen.findByTestId('partner-card')
    expect(screen.getByTestId('partner-save')).toBeEnabled()
    const s = (await d.designSessions.get(id))!
    await d.designSessions.put({ ...s, phase: 'done' })
    await waitFor(() => expect(screen.getByTestId('partner-save')).toBeDisabled(), { timeout: 3000 })
    expect(screen.getByText('This session is finished.')).toBeInTheDocument()
  })
})

describe('saving (DESIGN-64, 65)', () => {
  it('writes name, at and the scores (null for unchosen rows) to the same session', async () => {
    const { d, id } = await human()
    show(d, id)
    await screen.findByTestId('partner-card')
    fireEvent.change(screen.getByTestId('partner-name'), { target: { value: 'Sam' } })
    for (const [n, v] of [[1, 3], [2, 2], [3, 4]]) fireEvent.click(screen.getByTestId(`partner-score-${n}-${v}`))
    fireEvent.click(screen.getByTestId('partner-save'))
    await waitFor(() => expect(screen.getByTestId('partner-status')).toHaveTextContent('Saved'))
    expect((await d.designSessions.get(id))!.partner).toEqual({ name: 'Sam', at: T, scores: { perItem: [3, 2, 4, null, null], deepDives: [null, null, null, null] } })
  })
  it('a session that ends after a row was chosen cannot be saved: the button is off and nothing is written', async () => {
    const { d, id } = await human()
    show(d, id)
    await screen.findByTestId('partner-card')
    fireEvent.click(screen.getByTestId('partner-score-1-3'))
    const s = (await d.designSessions.get(id))!
    await d.designSessions.put({ ...s, phase: 'done' })
    await waitFor(() => expect(screen.getByTestId('partner-save')).toBeDisabled(), { timeout: 3000 })
    expect((await d.designSessions.get(id))!.partner).toEqual({})
  })
  it('a read-only browser (no writer token) shows the card and cannot score', async () => {
    const { d, id } = await human()
    show(d, id, true)
    await screen.findByTestId('partner-card')
    expect(screen.getByTestId('partner-save')).toBeDisabled()
  })
})

describe('the hash gate in App (F3)', () => {
  afterEach(() => { window.location.hash = '' })
  it('renders the card route instead of the shell when the hash is #/partner/<id>', async () => {
    window.location.hash = '#/partner/ds-none'
    const d = freshDb()
    await patchSettings(d, { startDate: '2026-09-07' })
    const fetcher = (async () => ({ ok: true, status: 200, json: async () => flatPlanV2 }) as unknown as Response) as typeof fetch
    const { container } = render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={fetcher} /></MemoryRouter>)
    const missing = await screen.findByTestId('partner-missing')
    expect(screen.getByTestId('screen-partner')).toContainElement(missing)
    expect(container.querySelector('nav, [data-testid="shell-rail"], [data-testid="shell-tabbar"]')).toBeNull()
  })
  it('a session id with dots and colons routes too', async () => {
    window.location.hash = '#/partner/ds.1:x'
    const d = freshDb()
    await patchSettings(d, { startDate: '2026-09-07' })
    const fetcher = (async () => ({ ok: true, status: 200, json: async () => flatPlanV2 }) as unknown as Response) as typeof fetch
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={fetcher} /></MemoryRouter>)
    await screen.findByTestId('partner-missing')
  })
  it('follows a hash change in the same page: a finished session opens as a read-only card with its saved note (DESIGN-114)', async () => {
    setNow(() => T)
    const d = freshDb()
    await patchSettings(d, { startDate: '2026-09-07' })
    const s = await startDesignSession(d, { designId: 'd-method', mode: 'human-partner', deepDives: DIVES, nowMs: T - 60_000 })
    await d.designSessions.put({ ...(await d.designSessions.get(s.id))!, phase: 'done', partner: { name: 'Sam', notes: 'Asked about scale first', scores: { perItem: [3, 3, 3, 3, 2], deepDives: [2, 1, 2, 0] } } })
    window.location.hash = '#/partner/ds-none'
    const fetcher = (async () => ({ ok: true, status: 200, json: async () => flatPlanV2 }) as unknown as Response) as typeof fetch
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={d} fetcher={fetcher} /></MemoryRouter>)
    await screen.findByTestId('partner-missing')
    window.location.hash = `#/partner/${s.id}`
    await screen.findByTestId('partner-card', undefined, { timeout: 3000 })
    expect(screen.getByTestId('partner-notes')).toBeDisabled()
    expect(screen.getByTestId('partner-notes')).toHaveValue('Asked about scale first')
    expect(screen.getByTestId('partner-notes-counter')).toHaveTextContent('23 / 2000')
    expect(screen.getByTestId('partner-name')).toHaveAttribute('readonly')
    expect(screen.getByText('This session is finished.')).toBeInTheDocument()
  })
})

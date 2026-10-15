import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Ticket } from '../../src/data/types'
import { Path } from '../../src/screens/Path'
import { freshDb } from '../helpers/db'
import { appPlans, mkAiTickets, mkPlanV2, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const ro = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))
afterEach(() => { ro.on = false })

/** A row drag as the browser reports it: the payload type the row sets is listed in `types`. */
const rowDt = (types: string[] = ['text/plain']) => ({ setData: vi.fn(), effectAllowed: '', types })

const plans = appPlans({ phases: mkPlanV2().phases.map(p => ({ ...p, authored: true })) })
const lane = (l: 'path' | 'dsa' | 'design', n: number, from: number): Ticket[] =>
  Array.from({ length: n }, (_, i) => mkTicket({ id: `${l}-${i + 1}`, lane: l, kind: l === 'dsa' ? 'problem' : l === 'design' ? 'design' : 'watch', title: `${l} ticket ${i + 1}`, order: from + i * 3, estMin: 30 }))

async function setup(extra: Ticket[] = [], opts: { careerLane?: boolean } = {}) {
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0, ...(opts.careerLane ? { careerLane: true } : {}) })
  const tickets = [...lane('path', 15, 1), ...lane('dsa', 15, 2), ...lane('design', 15, 3), ...extra]
  await d.tickets.bulkPut(tickets)
  renderWithApp(<Path />, { db: d, ...plans })
  await screen.findByTestId('path-upnext')
  return { d, tickets }
}
const ids = () => screen.getAllByTestId(/^row-/).map(r => r.getAttribute('data-ticket-id'))

describe('Path screen', () => {
  it('shows Doing, Up next and Done, with lane chips that count open tickets', async () => {
    await setup([mkTicket({ id: 'doing-1', lane: 'path', status: 'doing', order: 0 })])
    expect(within(screen.getByTestId('path-doing')).getByRole('heading', { name: /Doing/ })).toBeInTheDocument()
    expect(within(screen.getByTestId('path-upnext')).getByRole('heading', { name: /Up next/ })).toBeInTheDocument()
    expect(screen.getByTestId('path-doing-title').tagName).toBe('H2')
    expect(screen.getByTestId('path-doing-title').textContent).toMatch(/^Doing/)
    expect(screen.getByTestId('path-upnext-title').textContent).toMatch(/^Up next/)
    expect(screen.getByTestId('path-done-title').textContent).toMatch(/^Done/)
    expect(screen.getByTestId('path-lane-all')).toHaveTextContent('All 46')
    expect(screen.getByTestId('path-lane-path')).toHaveTextContent('AI 16')
    expect(screen.queryByTestId('path-lane-career')).toBeNull()
    expect(screen.getByTestId('path-lane-all')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('row-doing-1')).toHaveAttribute('data-status', 'doing')
  })

  it('says a finished lane is finished in one sentence with one action, and only then (GLOBAL-09)', async () => {
    const { d, tickets } = await setup()
    expect(document.querySelector('[data-empty="true"]')).toBeNull()
    await d.tickets.bulkPut(tickets.filter(t => t.lane === 'design').map(t => ({ ...t, status: 'done' as const, doneAt: 5 })))
    await waitFor(() => expect(screen.getByTestId('path-lane-design')).toHaveTextContent('done'))
    expect(document.querySelector('[data-empty="true"]')).toBeNull() // All still has rows
    fireEvent.click(screen.getByTestId('path-lane-design'))
    const empty = await screen.findByTestId('path-lane-empty')
    expect(empty).toHaveAttribute('data-empty', 'true')
    expect(empty.querySelectorAll('p')).toHaveLength(1)
    expect(empty.querySelectorAll('button, a')).toHaveLength(1)
    fireEvent.click(within(empty).getByRole('button'))
    expect(screen.queryByTestId('path-lane-empty')).toBeNull()
    expect(screen.getByTestId('path-lane-all')).toHaveAttribute('aria-pressed', 'true')
  })

  it('draws a row as kind glyph, title link, lane tag and estimate, with the data attributes (PATH-12)', async () => {
    await setup()
    const row = screen.getByTestId('row-dsa-1')
    expect(row).toHaveAttribute('data-lane', 'dsa')
    expect(row).toHaveAttribute('data-kind', 'problem')
    expect(row).toHaveAttribute('data-status', 'todo')
    expect(row).toHaveAttribute('data-ticket-id', 'dsa-1')
    expect(within(row).getByTestId('path-row-kind')).toHaveAttribute('data-kind', 'problem')
    expect(within(row).getByTestId('path-row-lane')).toHaveAttribute('data-lane', 'dsa')
    expect(within(row).getByTestId('path-row-lane').textContent).toBe('DSA')
    expect(within(row).getByTestId('path-row-est').textContent).toBe('30 min')
    const link = within(row).getByTestId('do-dsa-1')
    expect(link).toHaveAttribute('href', '/do/dsa-1')
    expect(link).toHaveAttribute('data-content', 'plan')
    expect(row.textContent).toBe('dsa ticket 1DSA30 min')
    expect(screen.getByTestId('row-path-1').querySelector('[data-testid="path-row-lane"]')!.textContent).toBe('AI')
  })

  it('shows the ticket title verbatim (no stripped prefix) and finds it by every part of it (PATH-09)', async () => {
    await setup([mkTicket({ id: 'lc-200', lane: 'dsa', kind: 'problem', title: '200 · Number of Islands', order: 0 })])
    expect(screen.getByRole('link', { name: '200 · Number of Islands' })).toHaveAttribute('href', '/do/lc-200')
    fireEvent.change(screen.getByTestId('path-search'), { target: { value: '200' } })
    expect(ids()).toEqual(['lc-200'])
  })

  it('lists the lanes as consecutive blocks AI, DSA, Design when the chip is All (PATH-03)', async () => {
    await setup()
    const lanes = screen.getAllByTestId(/^row-/).map(r => r.getAttribute('data-lane'))
    expect(lanes.slice(0, 10).every(l => l === 'path')).toBe(true)
    expect(lanes.slice(10, 20).every(l => l === 'dsa')).toBe(true)
    expect(lanes.slice(20, 30).every(l => l === 'design')).toBe(true)
    expect(ids().slice(0, 3)).toEqual(['path-1', 'path-2', 'path-3'])
  })

  it('renders at most ten rows per lane and "N more", and shows more on request', async () => {
    await setup()
    expect(screen.getAllByTestId(/^row-/)).toHaveLength(30)
    expect(screen.getByTestId('path-upnext-more')).toHaveTextContent('15 more')
    fireEvent.click(screen.getByTestId('path-upnext-more'))
    expect(screen.getAllByTestId(/^row-/)).toHaveLength(45)
    expect(screen.queryByTestId('path-upnext-more')).toBeNull()
  })

  it('filters by lane chip and by search without changing the chip counts', async () => {
    await setup()
    fireEvent.click(screen.getByTestId('path-lane-dsa'))
    expect(screen.getByTestId('path-lane-dsa')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('path-lane-path')).toHaveAttribute('aria-pressed', 'false')
    for (const row of screen.getAllByTestId(/^row-/)) expect(row).toHaveAttribute('data-lane', 'dsa')
    fireEvent.click(screen.getByTestId('path-lane-all'))
    fireEvent.change(screen.getByTestId('path-search'), { target: { value: 'DSA TICKET 3' } })
    expect(screen.getAllByTestId(/^row-/).map(r => r.getAttribute('data-ticket-id'))).toEqual(['dsa-3'])
    expect(screen.getByTestId('path-lane-dsa')).toHaveTextContent('DSA 15')
    fireEvent.change(screen.getByTestId('path-search'), { target: { value: 'zzzz' } })
    expect(screen.getByTestId('path-search-clear')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('path-search-clear'))
    expect(screen.getAllByTestId(/^row-/).length).toBeGreaterThan(1)
  })

  it('matches titles only: a word in the id but not the title keeps no row, and no match is one sentence plus Clear search (PATH-09, PATH-11)', async () => {
    await setup([mkTicket({ id: 'zebra-node', lane: 'dsa', kind: 'problem', title: 'Some plain title', order: 100 })])
    fireEvent.change(screen.getByTestId('path-search'), { target: { value: 'zebra' } })
    const none = screen.getByTestId('path-no-match')
    expect(none).toHaveAttribute('data-empty', 'true')
    expect(none.querySelectorAll('p')).toHaveLength(1)
    expect(none.querySelectorAll('button, a')).toHaveLength(1)
    expect(screen.getByTestId('path-search-clear')).toHaveTextContent('Clear search')
    expect(screen.queryAllByTestId(/^row-/)).toHaveLength(0)
    expect(screen.queryByTestId('path-doing-title')).toBeNull()
    expect(screen.getByTestId('path-lane-dsa')).toHaveTextContent('DSA 16')
  })

  it('searches Doing and Done as well (PATH-09)', async () => {
    await setup([
      mkTicket({ id: 'doing-q', lane: 'path', status: 'doing', title: 'Quokka in progress', order: 0 }),
      mkTicket({ id: 'done-q', lane: 'dsa', kind: 'problem', status: 'done', doneAt: 5, title: 'Quokka finished' }),
    ])
    fireEvent.click(screen.getByTestId('path-done-toggle'))
    fireEvent.change(screen.getByTestId('path-search'), { target: { value: 'quokka' } })
    expect(ids().sort()).toEqual(['doing-q', 'done-q'])
  })

  it('focuses the search box on "/" without typing it', async () => {
    await setup()
    fireEvent.keyDown(document.body, { key: '/' })
    expect(screen.getByTestId('path-search')).toHaveFocus()
    expect((screen.getByTestId('path-search') as HTMLInputElement).value).toBe('')
  })

  it('offers a quiet Start on the hovered row that starts it without moving it', async () => {
    const { d, tickets } = await setup()
    expect(screen.queryByTestId('path-row-start-path-1')).toBeNull()
    fireEvent.mouseEnter(screen.getByTestId('row-path-1'))
    const start = screen.getByTestId('path-row-start-path-1')
    expect(start).not.toHaveAttribute('data-accent')
    fireEvent.click(start)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/do/path-1'))
    await waitFor(async () => expect((await d.tickets.get('path-1'))!.status).toBe('doing'))
    const after = (await d.tickets.get('path-1'))!
    expect([after.order, after.orderOverride]).toEqual([tickets.find(t => t.id === 'path-1')!.order, undefined])
  })

  it('shows Start on keyboard focus too (PATH-16)', async () => {
    await setup()
    fireEvent.focus(screen.getByTestId('do-path-2'))
    expect(screen.getByTestId('path-row-start-path-2')).toBeInTheDocument()
  })

  it('keeps the focused row\'s Start while the pointer passes over other rows', async () => {
    await setup()
    fireEvent.focus(screen.getByTestId('do-path-2'))
    fireEvent.mouseEnter(screen.getByTestId('row-path-3'))
    expect(screen.getByTestId('path-row-start-path-2')).toBeInTheDocument()
    expect(screen.getByTestId('path-row-start-path-3')).toBeInTheDocument()
    fireEvent.mouseLeave(screen.getByTestId('row-path-3'))
    expect(screen.getByTestId('path-row-start-path-2')).toBeInTheDocument()
    expect(screen.queryByTestId('path-row-start-path-3')).toBeNull()
    fireEvent.blur(screen.getByTestId('do-path-2'))
    expect(screen.queryByTestId('path-row-start-path-2')).toBeNull()
  })

  it('puts the accent Resume on the first Doing row only, and warns above three without blocking', async () => {
    const doing = ['a', 'b', 'c', 'd'].map((id, i) => mkTicket({ id: `doing-${id}`, lane: 'path', status: 'doing', order: i }))
    await setup(doing)
    expect(screen.getByTestId('path-doing-warning')).toHaveTextContent('3')
    const accents = document.querySelectorAll('[data-accent="primary"]')
    expect(accents).toHaveLength(1)
    expect(screen.getByTestId('path-doing')).toContainElement(accents[0] as HTMLElement)
    expect(accents[0].textContent).toMatch(/^RESUME · /i)
    expect(screen.getByTestId('path-row-resume-doing-b')).not.toHaveAttribute('data-accent')
  })

  it('has no accent when nothing is doing', async () => {
    await setup()
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(0)
  })

  it('reorders within a lane with Alt+ArrowDown, writes only orderOverride, and keeps focus on the link (PATH-31)', async () => {
    const { d } = await setup()
    fireEvent.click(screen.getByTestId('path-lane-dsa'))
    screen.getByTestId('do-dsa-1').focus()
    fireEvent.keyDown(screen.getByTestId('do-dsa-1'), { key: 'ArrowDown', altKey: true })
    ;(document.activeElement as HTMLElement).blur() // a browser drops focus when the keyed row is re-inserted; the screen must give it back
    await waitFor(async () => expect((await d.tickets.get('dsa-1'))!.orderOverride).toBeDefined())
    const moved = (await d.tickets.get('dsa-1'))!
    expect(moved.order).toBe(2)
    expect(moved.orderOverride!).toBeGreaterThan(5)
    expect(moved.orderOverride!).toBeLessThan(8)
    expect((await d.tickets.get('dsa-2'))!.orderOverride).toBeUndefined()
    await waitFor(() => expect(ids().slice(0, 3)).toEqual(['dsa-2', 'dsa-1', 'dsa-3']))
    await waitFor(() => expect(screen.getByTestId('do-dsa-1')).toHaveFocus())
  })

  it('moves the 3rd row above the 2nd with Alt+ArrowUp and keeps focus (PATH-31)', async () => {
    const { d } = await setup()
    fireEvent.click(screen.getByTestId('path-lane-dsa'))
    screen.getByTestId('do-dsa-3').focus()
    fireEvent.keyDown(screen.getByTestId('do-dsa-3'), { key: 'ArrowUp', altKey: true })
    ;(document.activeElement as HTMLElement).blur()
    await waitFor(async () => expect((await d.tickets.get('dsa-3'))!.orderOverride).toBeDefined())
    const v = (await d.tickets.get('dsa-3'))!.orderOverride!
    expect(v).toBeGreaterThan(2) // dsa-1 is order 2
    expect(v).toBeLessThan(5) // dsa-2 is order 5
    for (const id of ['dsa-1', 'dsa-2', 'dsa-4']) expect((await d.tickets.get(id))!.orderOverride).toBeUndefined()
    await waitFor(() => expect(ids().slice(0, 3)).toEqual(['dsa-1', 'dsa-3', 'dsa-2']))
    await waitFor(() => expect(screen.getByTestId('do-dsa-3')).toHaveFocus())
    // the announcement comes after the move, and the plan text in it is marked as plan content
    const said = screen.getByTestId('path-live')
    expect(said).toHaveTextContent('Moved dsa ticket 3 up.')
    expect(said.querySelector('[data-content="plan"]')).toHaveTextContent('dsa ticket 3')
  })

  it('reorders a legacy slid ticket by keyboard like a drag does (PATH-31)', async () => {
    const { d } = await setup([mkTicket({ id: 'dsa-slid', lane: 'dsa', kind: 'problem', status: 'slid', title: 'slid one', order: 6 })])
    fireEvent.click(screen.getByTestId('path-lane-dsa'))
    const before = ids()
    const i = before.indexOf('dsa-slid')
    expect(i).toBeGreaterThan(0)
    screen.getByTestId('do-dsa-slid').focus()
    fireEvent.keyDown(screen.getByTestId('do-dsa-slid'), { key: 'ArrowUp', altKey: true })
    await waitFor(async () => expect((await d.tickets.get('dsa-slid'))!.orderOverride).toBeDefined())
    await waitFor(() => expect(ids().indexOf('dsa-slid')).toBe(i - 1))
  })

  it('does nothing for Alt+ArrowUp on the first row or Alt+ArrowDown on the last row of a lane (PATH-31)', async () => {
    const { d } = await setup()
    fireEvent.click(screen.getByTestId('path-lane-dsa'))
    fireEvent.keyDown(screen.getByTestId('do-dsa-1'), { key: 'ArrowUp', altKey: true })
    fireEvent.keyDown(screen.getByTestId('do-dsa-10'), { key: 'ArrowDown', altKey: true })
    await new Promise(r => setTimeout(r, 40))
    for (const t of await d.tickets.toArray()) expect(t.orderOverride).toBeUndefined()
  })

  it('drops a row above another of its lane, refuses a drop across lanes, and ignores a drop on Done', async () => {
    const { d } = await setup()
    const dt = rowDt()
    fireEvent.dragStart(screen.getByTestId('row-dsa-5'), { dataTransfer: dt })
    fireEvent.dragOver(screen.getByTestId('row-dsa-2'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('row-dsa-2'), { dataTransfer: dt })
    await waitFor(async () => expect((await d.tickets.get('dsa-5'))!.orderOverride).toBeDefined())
    const v = (await d.tickets.get('dsa-5'))!.orderOverride!
    expect(v).toBeGreaterThan(2) // dsa-1 has order 2
    expect(v).toBeLessThan(5) // dsa-2 has order 5
    expect((await d.tickets.get('dsa-5'))!.order).toBe(14)
    fireEvent.dragStart(screen.getByTestId('row-dsa-6'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('row-path-3'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('path-done'), { dataTransfer: dt })
    await new Promise(r => setTimeout(r, 40))
    expect((await d.tickets.get('dsa-6'))!.orderOverride).toBeUndefined()
    expect((await d.tickets.get('dsa-6'))!.status).toBe('todo')
  })

  it('ignores a foreign drop after a row drag ended without a drop, and a drop that is not a row drag', async () => {
    const { d } = await setup([mkTicket({ id: 'doing-1', lane: 'path', status: 'doing', order: 0 })])
    const dt = rowDt()
    fireEvent.dragStart(screen.getByTestId('row-dsa-4'), { dataTransfer: dt })
    fireEvent.dragEnd(screen.getByTestId('row-dsa-4'), { dataTransfer: dt }) // cancelled (Escape / dropped outside)
    fireEvent.drop(screen.getByTestId('path-doing'), { dataTransfer: rowDt(['text/plain']) }) // e.g. selected text dragged in from elsewhere
    fireEvent.drop(screen.getByTestId('row-dsa-2'), { dataTransfer: rowDt(['text/plain']) })
    // a live row drag, but the thing dropped carries no row payload (a file)
    fireEvent.dragStart(screen.getByTestId('row-dsa-5'), { dataTransfer: dt })
    fireEvent.dragOver(screen.getByTestId('path-doing'), { dataTransfer: rowDt(['Files']) })
    fireEvent.drop(screen.getByTestId('path-doing'), { dataTransfer: rowDt(['Files']) })
    fireEvent.drop(screen.getByTestId('row-dsa-2'), { dataTransfer: rowDt(['Files']) })
    await new Promise(r => setTimeout(r, 40))
    for (const t of await d.tickets.toArray()) {
      expect(t.orderOverride).toBeUndefined()
      if (t.id !== 'doing-1') expect(t.status).toBe('todo')
    }
  })

  it('ignores a drop of an Up next or Doing row on a Done row (PATH-22)', async () => {
    const { d } = await setup([mkTicket({ id: 'fin', lane: 'dsa', kind: 'problem', status: 'done', doneAt: 1 }), mkTicket({ id: 'doing-x', lane: 'dsa', kind: 'problem', status: 'doing', order: 0 })])
    fireEvent.click(screen.getByTestId('path-done-toggle'))
    const dt = rowDt()
    for (const from of ['row-dsa-3', 'row-doing-x']) {
      fireEvent.dragStart(screen.getByTestId(from), { dataTransfer: dt })
      fireEvent.drop(screen.getByTestId('row-fin'), { dataTransfer: dt })
    }
    await new Promise(r => setTimeout(r, 40))
    expect((await d.tickets.get('dsa-3'))!.status).toBe('todo')
    expect((await d.tickets.get('dsa-3'))!.orderOverride).toBeUndefined()
    expect((await d.tickets.get('doing-x'))!.orderOverride).toBeUndefined()
    expect((await d.tickets.get('fin'))!.status).toBe('done')
  })

  it('drops an Up next row on Doing to start it, without an order override', async () => {
    const { d } = await setup()
    const dt = rowDt()
    fireEvent.dragStart(screen.getByTestId('row-path-4'), { dataTransfer: dt })
    fireEvent.dragOver(screen.getByTestId('path-doing'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('path-doing'), { dataTransfer: dt })
    await waitFor(async () => expect((await d.tickets.get('path-4'))!.status).toBe('doing'))
    expect((await d.tickets.get('path-4'))!.orderOverride).toBeUndefined()
  })

  it('treats a drop on a Doing row as a drop on the Doing group (PATH-19)', async () => {
    const { d } = await setup([mkTicket({ id: 'doing-1', lane: 'path', status: 'doing', order: 0 })])
    const dt = rowDt()
    fireEvent.dragStart(screen.getByTestId('row-dsa-4'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('row-doing-1'), { dataTransfer: dt })
    await waitFor(async () => expect((await d.tickets.get('dsa-4'))!.status).toBe('doing'))
    expect((await d.tickets.get('dsa-4'))!.orderOverride).toBeUndefined()
  })

  it('opens Done by itself when a search finds only finished tickets', async () => {
    await setup([mkTicket({ id: 'fin-q', lane: 'dsa', kind: 'problem', status: 'done', doneAt: 5, title: 'Quokka finished' })])
    expect(screen.getByTestId('path-done-toggle')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.change(screen.getByTestId('path-search'), { target: { value: 'quokka' } })
    expect(screen.getByTestId('path-done-toggle')).toHaveAttribute('aria-expanded', 'true')
    expect(ids()).toEqual(['fin-q'])
    fireEvent.change(screen.getByTestId('path-search'), { target: { value: '' } })
    expect(screen.getByTestId('path-done-toggle')).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps Done collapsed with its count, then lists the newest first', async () => {
    await setup([mkTicket({ id: 'old', status: 'done', doneAt: 10 }), mkTicket({ id: 'new', status: 'done', doneAt: 20 })])
    const toggle = screen.getByTestId('path-done-toggle')
    expect(toggle).toHaveTextContent(/Done\s*2/)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('row-new')).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getAllByTestId(/^row-(new|old)$/).map(r => r.getAttribute('data-ticket-id'))).toEqual(['new', 'old'])
  })

  it('pages a long Done list with "N more" (PATH-23)', async () => {
    const done = Array.from({ length: 30 }, (_, i) => mkTicket({ id: `dn-${i}`, status: 'done', doneAt: 100 + i }))
    await setup(done)
    fireEvent.click(screen.getByTestId('path-done-toggle'))
    expect(screen.getAllByTestId(/^row-dn-/)).toHaveLength(25)
    expect(screen.getByTestId('path-done-more')).toHaveTextContent('5 more')
    fireEvent.click(screen.getByTestId('path-done-more'))
    expect(screen.getAllByTestId(/^row-dn-/)).toHaveLength(30)
    expect(screen.queryByTestId('path-done-more')).toBeNull()
  })

  it('shows a done bank ticket as DSA under the DSA chip (PATH-06, README lane tag)', async () => {
    await setup([mkTicket({ id: 'bk', origin: 'bank:dsa' as Ticket['origin'], lane: 'bank', kind: 'problem', status: 'done', doneAt: 3 })])
    fireEvent.click(screen.getByTestId('path-lane-dsa'))
    fireEvent.click(screen.getByTestId('path-done-toggle'))
    const row = screen.getByTestId('row-bk')
    expect(row).toHaveAttribute('data-lane', 'dsa')
    expect(within(row).getByTestId('path-row-lane').textContent).toBe('DSA')
  })

  it('hides archived tickets everywhere (PATH-24)', async () => {
    await setup([mkTicket({ id: 'gone', lane: 'dsa', kind: 'problem', archived: true, order: 0 }), mkTicket({ id: 'gone-done', status: 'done', archived: true })])
    fireEvent.click(screen.getByTestId('path-done-toggle'))
    expect(screen.queryByTestId('row-gone')).toBeNull()
    expect(screen.queryByTestId('row-gone-done')).toBeNull()
  })

  it('says a phase is being written when the AI lane is empty, and does not call it done (Review Focus 1)', async () => {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.bulkPut([...mkAiTickets().map(t => ({ ...t, status: 'done' as const })), ...lane('dsa', 3, 100)])
    renderWithApp(<Path />, { db: d, ...appPlans() })
    await screen.findByTestId('path-upnext')
    fireEvent.click(screen.getByTestId('path-lane-path'))
    expect(screen.getByTestId('path-phase-note')).toHaveTextContent('Phase 2 tickets are being written')
    expect(screen.getByTestId('path-lane-path')).not.toHaveTextContent(/done/i)
    expect(screen.queryAllByTestId(/^row-/)).toHaveLength(0)
    expect(screen.queryByTestId('path-empty')).toBeNull()
    expect(screen.getByTestId('path-upnext-title')).toBeInTheDocument()
  })

  it('shows a finished lane as done on its chip and keeps the groups (PATH-08)', async () => {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.bulkPut([...lane('path', 3, 1), mkTicket({ id: 'dz', lane: 'design', kind: 'design', status: 'done' })])
    renderWithApp(<Path />, { db: d, ...plans })
    await screen.findByTestId('path-upnext')
    expect(screen.getByTestId('path-lane-design')).toHaveTextContent(/done/i)
    fireEvent.click(screen.getByTestId('path-lane-design'))
    expect(screen.queryByTestId('path-empty')).toBeNull()
    expect(screen.queryAllByTestId(/^row-/)).toHaveLength(0)
    expect(screen.getByTestId('path-upnext')).toBeInTheDocument()
  })

  it('shows the Career chip and rows only when the lane is on (PATH-07)', async () => {
    const career = [mkTicket({ id: 'cr-1', lane: 'career', kind: 'task', title: 'Update résumé', order: 50 })]
    await setup(career, { careerLane: true })
    expect(screen.getByTestId('path-lane-career')).toHaveTextContent('Career 1')
    fireEvent.click(screen.getByTestId('path-lane-career'))
    expect(ids()).toEqual(['cr-1'])
    expect(screen.getByTestId('row-cr-1')).toHaveAttribute('data-lane', 'career')
  })

  it('shows path-empty only when no ticket exists at all (and as one sentence plus one action)', async () => {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    renderWithApp(<Path />, { db: d, ...plans })
    const empty = await screen.findByTestId('path-empty')
    expect(empty).toHaveAttribute('data-empty', 'true')
    expect(empty.querySelectorAll('p')).toHaveLength(1)
    expect(empty.querySelectorAll('button, a')).toHaveLength(1)
  })

  it('stays under 60 controls in the default state', async () => {
    await setup([mkTicket({ id: 'doing-1', lane: 'path', status: 'doing', order: 0 })])
    const root = screen.getByTestId('path-doing').closest('.pq')!
    const controls = root.querySelectorAll('a[href], button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')
    expect(controls.length).toBeLessThanOrEqual(60)
  })
})

describe('Path screen in a read-only browser (Review Focus 4)', () => {
  it('offers no Start, disables Resume, makes rows undraggable, and writes nothing for drag or Alt+Arrow', async () => {
    ro.on = true
    const { d } = await setup([mkTicket({ id: 'doing-1', lane: 'path', status: 'doing', order: 0 })])
    const before = JSON.stringify((await d.tickets.toArray()).sort((a, b) => a.id.localeCompare(b.id)))
    fireEvent.mouseEnter(screen.getByTestId('row-path-2'))
    fireEvent.focus(screen.getByTestId('do-path-3'))
    expect(screen.queryAllByTestId(/^path-row-start-/)).toHaveLength(0)
    expect(screen.getByTestId('path-row-resume-doing-1')).toBeDisabled()
    for (const row of screen.getAllByTestId(/^row-/)) expect(row).toHaveAttribute('draggable', 'false')
    const dt = rowDt()
    fireEvent.dragStart(screen.getByTestId('row-dsa-4'), { dataTransfer: dt })
    fireEvent.dragOver(screen.getByTestId('path-doing'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('path-doing'), { dataTransfer: dt })
    fireEvent.dragStart(screen.getByTestId('row-dsa-5'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('row-dsa-2'), { dataTransfer: dt })
    fireEvent.drop(screen.getByTestId('row-doing-1'), { dataTransfer: dt })
    fireEvent.keyDown(screen.getByTestId('do-dsa-3'), { key: 'ArrowUp', altKey: true })
    fireEvent.keyDown(screen.getByTestId('do-dsa-3'), { key: 'ArrowDown', altKey: true })
    await new Promise(r => setTimeout(r, 60))
    expect(JSON.stringify((await d.tickets.toArray()).sort((a, b) => a.id.localeCompare(b.id)))).toBe(before)
  })
})

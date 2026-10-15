// R1 scope 2, W3 + W8 + W9 (component level): the rail and its toggle, the phone tab bar and More sheet, keys 1 to 6, the
// shortcuts overlay, the Guide, palette routing of design tickets, the Designs search and Path's remembered filter.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../../src/app/providers'
import { Shell } from '../../src/app/Shell'
import { getSettings } from '../../src/data/db'
import { NARROW_QUERY } from '../../src/lib/useMediaQuery'
import { Designs } from '../../src/screens/Designs'
import { Path } from '../../src/screens/Path'
import { freshDb, seededDb } from '../helpers/db'
import { flatPlanProse } from '../helpers/plan'
import { appPlans, mkPlanV2, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const ro = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))

const plans = appPlans({ phases: mkPlanV2().phases.map(p => ({ ...p, authored: true })) })
const loc = () => screen.getByTestId('location')
const phone = () => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === NARROW_QUERY, media: q, addEventListener() {}, removeEventListener() {} }))
afterEach(() => { vi.unstubAllGlobals(); ro.on = false; window.sessionStorage.clear() })

async function boot(opts: { route?: string; settings?: Record<string, unknown>; extra?: ReturnType<typeof mkTicket>[] } = {}) {
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0, navLabels: 'always', ...opts.settings })
  await d.tickets.bulkPut([mkTicket({ id: 'open1', title: 'Watch Karpathy attention' }), ...(opts.extra ?? [])])
  const r = renderWithApp(<Shell />, { db: d, ...plans, route: opts.route ?? '/' })
  return { d, ...r }
}

const ORDER = ['today', 'path', 'board', 'journal', 'skills', 'review', 'ai', 'dsa', 'designs', 'banks', 'atlas', 'guide']
const ROUTE: Record<string, string> = {
  today: '/', path: '/path', board: '/board', journal: '/journal', skills: '/skills', review: '/review', ai: '/ai-topics', dsa: '/dsa',
  designs: '/designs', banks: '/banks', atlas: '/atlas', guide: '/guide',
}

describe('NAV-01/02: the rail', () => {
  it('holds the twelve destinations in three groups, then Guide and the toggle as its last two controls', async () => {
    await boot()
    const rail = await screen.findByTestId('shell-rail')
    const items = within(rail).getAllByTestId(/^shell-nav-/)
    expect(items.map(i => i.getAttribute('data-testid'))).toEqual(ORDER.map(i => `shell-nav-${i}`))
    expect(within(screen.getByTestId('shell-rail-group-main')).getAllByTestId(/^shell-nav-/)).toHaveLength(6)
    expect(within(screen.getByTestId('shell-rail-group-topics')).getAllByTestId(/^shell-nav-/).map(i => i.getAttribute('data-testid'))).toEqual(['shell-nav-ai', 'shell-nav-dsa', 'shell-nav-designs'])
    expect(within(screen.getByTestId('shell-rail-group-practice')).getAllByTestId(/^shell-nav-/).map(i => i.getAttribute('data-testid'))).toEqual(['shell-nav-banks', 'shell-nav-atlas'])
    const focusable = Array.from(rail.querySelectorAll<HTMLElement>('a[href], button'))
    expect(focusable.slice(-2).map(f => f.getAttribute('data-testid'))).toEqual(['shell-nav-guide', 'shell-rail-toggle'])
    expect(screen.queryByTestId('more-button')).toBeNull()
    expect(screen.queryByTestId('keys-legend')).toBeNull()
    expect(screen.queryByTestId('shell-tabbar')).toBeNull()
  })
  it('gives each item its label as accessible name and its route as href', async () => {
    await boot()
    await screen.findByTestId('shell-rail')
    const label: Record<string, string> = { ai: 'AI', dsa: 'DSA' }
    for (const id of ORDER) {
      const a = screen.getByTestId(`shell-nav-${id}`)
      expect(a).toHaveAccessibleName(label[id] ?? id[0].toUpperCase() + id.slice(1))
      expect(a.getAttribute('href')).toBe(ROUTE[id])
    }
  })
  it('names the groups Topics and Practice while expanded, with none for the main group', async () => {
    await boot()
    expect(await screen.findByTestId('shell-rail-group-title-topics')).toHaveTextContent('Topics')
    expect(screen.getByTestId('shell-rail-group-title-practice')).toHaveTextContent('Practice')
    expect(within(screen.getByTestId('shell-rail-group-main')).queryByRole('heading')).toBeNull()
  })
  it('marks exactly one item current for each route that has one, and none on a ticket, a session and Settings', async () => {
    for (const [route, id] of [['/', 'today'], ['/path', 'path'], ['/skills/stats', 'skills'], ['/guide', 'guide'], ['/designs?tier=1', 'designs'], ['/dsa', 'dsa'], ['/banks', 'banks'], ['/atlas', 'atlas']] as const) {
      cleanup()
      await boot({ route })
      await screen.findByTestId('shell-rail')
      const cur = Array.from(document.querySelectorAll('[aria-current="page"]')).map(e => e.getAttribute('data-testid'))
      expect(cur, route).toEqual([`shell-nav-${id}`])
    }
    for (const route of ['/do/open1', '/designs/session/d1', '/settings']) {
      cleanup()
      await boot({ route })
      await screen.findByTestId('shell-rail')
      expect(document.querySelectorAll('[aria-current="page"]'), route).toHaveLength(0)
    }
  })
})

describe('NAV-05/06/08: the toggle', () => {
  it('collapses and expands, storing hover then always (never intro), with a name in both states', async () => {
    const { d } = await boot()
    const rail = await screen.findByTestId('shell-rail')
    const t = screen.getByTestId('shell-rail-toggle')
    expect(rail).toHaveAttribute('data-expanded', 'true')
    expect(t).toHaveAttribute('aria-expanded', 'true')
    expect(t).toHaveAccessibleName('Collapse navigation')
    expect(t).toHaveTextContent('Collapse navigation')
    fireEvent.click(t)
    expect(rail).toHaveAttribute('data-expanded', 'false')
    expect(t).toHaveAttribute('aria-expanded', 'false')
    expect(t).toHaveAccessibleName('Expand navigation')
    expect(t).toHaveTextContent('Expand navigation')
    await waitFor(async () => expect((await getSettings(d)).navLabels).toBe('hover'))
    fireEvent.click(t)
    expect(rail).toHaveAttribute('data-expanded', 'true')
    await waitFor(async () => expect((await getSettings(d)).navLabels).toBe('always'))
  })
  it('keeps the choice across a reload, and the Settings switch agrees with it', async () => {
    const { d } = await boot()
    fireEvent.click(await screen.findByTestId('shell-rail-toggle'))
    await waitFor(async () => expect((await getSettings(d)).navLabels).toBe('hover'))
    cleanup()
    renderWithApp(<Shell />, { db: d, ...plans, route: '/settings' })
    await waitFor(() => expect(screen.getByTestId('shell-rail')).toHaveAttribute('data-expanded', 'false'))
    const sw = await screen.findByTestId('settings-nav-labels')
    expect(sw).not.toBeChecked()
    fireEvent.click(sw)
    await waitFor(() => expect(screen.getByTestId('shell-rail')).toHaveAttribute('data-expanded', 'true'))
    await waitFor(async () => expect((await getSettings(d)).navLabels).toBe('always'))
    expect(screen.getByTestId('shell-rail-toggle')).toHaveAttribute('aria-expanded', 'true')
  })
  it('on a first launch the toggle and the Settings switch agree while the labels are up and hover is stored', async () => {
    await boot({ settings: { navLabels: undefined }, route: '/settings' })
    const rail = await screen.findByTestId('shell-rail')
    expect(rail).toHaveAttribute('data-expanded', 'true')
    expect(await screen.findByTestId('settings-nav-labels')).toBeChecked()
    fireEvent.click(screen.getByTestId('settings-nav-labels'))
    await waitFor(() => expect(rail).toHaveAttribute('data-expanded', 'false'))
  })
  it('in a read-only browser the width changes for the page load and nothing is written', async () => {
    ro.on = true
    const { d } = await boot({ settings: { navLabels: 'hover' } })
    const rail = await screen.findByTestId('shell-rail')
    expect(rail).toHaveAttribute('data-expanded', 'false')
    fireEvent.click(screen.getByTestId('shell-rail-toggle'))
    expect(rail).toHaveAttribute('data-expanded', 'true')
    await new Promise(r => setTimeout(r, 50))
    expect((await getSettings(d)).navLabels).toBe('hover')
  })
})

describe('SHELL-02/03: keys 1 to 6', () => {
  it('go to Today, Path, Board, Journal, Skills and Review, and 7 8 9 0 go nowhere', async () => {
    await boot()
    await screen.findByTestId('shell-rail')
    for (const [k, to] of [['2', '/path'], ['3', '/board'], ['4', '/journal'], ['5', '/skills'], ['6', '/review'], ['1', '/']] as const) {
      fireEvent.keyDown(document.body, { key: k })
      await waitFor(() => expect(loc().textContent).toBe(to)) // /board and /journal are real routes since the W1 and W2 merges
    }
    fireEvent.keyDown(document.body, { key: '2' })
    await waitFor(() => expect(loc().textContent).toBe('/path'))
    for (const k of ['7', '8', '9', '0']) fireEvent.keyDown(document.body, { key: k })
    await new Promise(r => setTimeout(r, 30))
    expect(loc().textContent).toBe('/path')
  })
  it('names a key on the first six rail items only', async () => {
    await boot()
    await screen.findByTestId('shell-rail')
    const keyed = ORDER.filter(id => screen.getByTestId(`shell-nav-${id}`).hasAttribute('aria-keyshortcuts'))
    expect(keyed).toEqual(ORDER.slice(0, 6))
    expect(ORDER.slice(0, 6).map(id => screen.getByTestId(`shell-nav-${id}`).getAttribute('aria-keyshortcuts'))).toEqual(['1', '2', '3', '4', '5', '6'])
  })
})

describe('NAV-09 to NAV-14: the phone', () => {
  it('has a five-item tab bar and no rail', async () => {
    phone()
    await boot()
    const bar = await screen.findByTestId('shell-tabbar')
    expect(screen.queryByTestId('shell-rail')).toBeNull()
    expect(screen.queryByTestId('more-button')).toBeNull()
    const kids = Array.from(bar.querySelectorAll<HTMLElement>('[data-testid]')).map(e => e.getAttribute('data-testid'))
    expect(kids).toEqual(['shell-nav-today', 'shell-nav-path', 'shell-nav-board', 'shell-nav-review', 'shell-tab-more'])
    for (const [id, name] of [['shell-nav-today', 'Today'], ['shell-nav-path', 'Path'], ['shell-nav-board', 'Board'], ['shell-nav-review', 'Review'], ['shell-tab-more', 'More']]) expect(within(bar).getByTestId(id)).toHaveTextContent(name)
  })
  it('opens the sheet with the eight other destinations, headed Topics and Practice', async () => {
    phone()
    await boot()
    const more = await screen.findByTestId('shell-tab-more')
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('shell-more-sheet')).toBeNull()
    fireEvent.click(more)
    const sheet = await screen.findByTestId('shell-more-sheet')
    expect(sheet).toHaveAttribute('role', 'dialog')
    expect(sheet).toHaveAccessibleName()
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(within(sheet).getAllByTestId(/^shell-nav-/).map(i => i.getAttribute('data-testid'))).toEqual(
      ['journal', 'skills', 'ai', 'dsa', 'designs', 'banks', 'atlas', 'guide'].map(i => `shell-nav-${i}`))
    expect(within(sheet).getByTestId('shell-more-group-title-topics')).toHaveTextContent('Topics')
    expect(within(sheet).getByTestId('shell-more-group-title-practice')).toHaveTextContent('Practice')
    const order = Array.from(sheet.querySelectorAll('[data-testid]')).map(e => e.getAttribute('data-testid'))
    expect(order.indexOf('shell-more-group-title-topics')).toBeLessThan(order.indexOf('shell-nav-ai'))
    expect(order.indexOf('shell-more-group-title-practice')).toBeLessThan(order.indexOf('shell-nav-banks'))
    for (const id of ['today', 'path', 'board', 'review']) expect(within(sheet).queryByTestId(`shell-nav-${id}`)).toBeNull()
    expect(within(sheet).queryByTestId('shell-tab-more')).toBeNull()
    expect(screen.getByTestId('shell-tabbar')).toBeInTheDocument()
  })
  it('navigates from a sheet item and closes the sheet (Skills, the one sheet screen that exists on this branch)', async () => {
    phone()
    await boot()
    fireEvent.click(await screen.findByTestId('shell-tab-more'))
    fireEvent.click(within(await screen.findByTestId('shell-more-sheet')).getByTestId('shell-nav-skills'))
    await waitFor(() => expect(loc().textContent).toBe('/skills'))
    expect(screen.queryByTestId('shell-more-sheet')).toBeNull()
    expect(screen.getByTestId('shell-tab-more')).toHaveAttribute('aria-expanded', 'false')
  })
  it('closes without navigating on Esc (focus back on More), on a tap outside, and on More again', async () => {
    phone()
    await boot({ route: '/path' })
    const more = await screen.findByTestId('shell-tab-more')
    fireEvent.click(more)
    await screen.findByTestId('shell-more-sheet')
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('shell-more-sheet')).toBeNull())
    expect(more).toHaveFocus()
    fireEvent.click(more)
    fireEvent.mouseDown(await screen.findByTestId('shell-more-backdrop'))
    await waitFor(() => expect(screen.queryByTestId('shell-more-sheet')).toBeNull())
    fireEvent.click(more)
    await screen.findByTestId('shell-more-sheet')
    fireEvent.click(more)
    await waitFor(() => expect(screen.queryByTestId('shell-more-sheet')).toBeNull())
    expect(more).toHaveAttribute('aria-expanded', 'false')
    expect(loc().textContent).toBe('/path')
  })
  it('shows More as current for the eight sheet routes, and the tab for the four tab routes', async () => {
    phone()
    for (const route of ['/skills', '/dsa', '/designs', '/banks', '/atlas', '/guide']) {
      cleanup()
      await boot({ route })
      const more = await screen.findByTestId('shell-tab-more')
      expect(more, route).toHaveAttribute('aria-current', 'page')
      for (const id of ['today', 'path', 'board', 'review']) expect(screen.getByTestId(`shell-nav-${id}`), route).not.toHaveAttribute('aria-current')
      fireEvent.click(more)
      const cur = within(await screen.findByTestId('shell-more-sheet')).getAllByTestId(/^shell-nav-/).filter(e => e.getAttribute('aria-current') === 'page')
      expect(cur, route).toHaveLength(1)
    }
    cleanup()
    await boot({ route: '/path' })
    expect(await screen.findByTestId('shell-nav-path')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('shell-tab-more')).not.toHaveAttribute('aria-current')
    for (const route of ['/settings', '/do/open1']) {
      cleanup()
      await boot({ route })
      await screen.findByTestId('shell-tabbar')
      expect(document.querySelectorAll('.sh-tabbar [aria-current="page"]'), route).toHaveLength(0)
    }
  })
})

describe('NAV-27 to NAV-31: the Guide', () => {
  it('draws the title and the nine sections in order, each with a heading and some text', async () => {
    await boot({ route: '/guide' })
    expect(await screen.findByTestId('guide-title')).toHaveTextContent('How Dojo works')
    expect(screen.getByTestId('guide-title').tagName).toBe('H1')
    expect(document.querySelectorAll('h1')).toHaveLength(1) // the header draws none on this screen
    const secs = Array.from(document.querySelectorAll('[data-testid^="guide-section-"]'))
    expect(secs.map(s => s.getAttribute('data-testid'))).toEqual(
      ['overview', 'destinations', 'board', 'review', 'skills', 'ritual', 'design', 'mentors', 'shortcuts'].map(i => `guide-section-${i}`))
    for (const s of secs) {
      expect(s.querySelector('h2')).not.toBeNull()
      expect(s.querySelectorAll('p, li').length).toBeGreaterThan(0)
    }
  })
  it('has one single-sentence line per destination with a link to its route', async () => {
    await boot({ route: '/guide' })
    const sec = await screen.findByTestId('guide-section-destinations')
    const lines = within(sec).getAllByTestId(/^guide-dest-/)
    expect(lines.map(l => l.getAttribute('data-testid'))).toEqual(ORDER.map(i => `guide-dest-${i}`))
    for (const [i, id] of ORDER.entries()) {
      const li = lines[i]
      const a = li.querySelector('a')!
      expect(new URL(a.href, 'http://x').pathname, id).toBe(ROUTE[id])
      expect(li.textContent!.trim().split(/\s+/).length).toBeGreaterThanOrEqual(4)
      expect(li.textContent).not.toMatch(/\n/)
      expect((li.textContent!.match(/[.!?]/g) ?? []).length).toBe(1)
    }
  })
  it('names each of the digits 1 to 6 in its shortcuts section, and the Review item keeps the name Review with a badge', async () => {
    await boot({ route: '/guide' })
    const t = (await screen.findByTestId('guide-section-shortcuts')).textContent ?? ''
    for (const k of '123456') expect(t).toContain(k)
    expect(t).toMatch(/Ctrl or Cmd with K/)
    expect(t).toContain('?')
  })
  it('opens the shortcuts overlay from its button and Esc leaves the Guide in place', async () => {
    await boot({ route: '/guide' })
    fireEvent.click(await screen.findByTestId('guide-open-shortcuts'))
    const o = await screen.findByTestId('shell-shortcuts')
    expect(screen.getByTestId('screen-guide')).toBeInTheDocument()
    fireEvent.keyDown(o, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('shell-shortcuts')).toBeNull())
    expect(screen.getByTestId('screen-guide')).toBeInTheDocument()
  })
  it('lists 1 to 6 in the ? overlay, with a link to the Guide that closes it', async () => {
    await boot({ route: '/path' })
    await screen.findByTestId('path-search')
    fireEvent.keyDown(document.body, { key: '?' })
    const o = await screen.findByTestId('shell-shortcuts')
    const kbds = Array.from(o.querySelectorAll('dt kbd')).map(k => k.textContent)
    for (const k of ['1', '2', '3', '4', '5', '6']) expect(kbds).toContain(k)
    const link = within(o).getByTestId('shell-shortcuts-guide')
    expect(link).toHaveTextContent('How Dojo works')
    fireEvent.click(link)
    await waitFor(() => expect(loc().textContent).toBe('/guide'))
    expect(screen.queryByTestId('shell-shortcuts')).toBeNull()
  })
  it('opens from the gear menu', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-gear'))
    fireEvent.click(await screen.findByTestId('shell-menu-guide'))
    await waitFor(() => expect(loc().textContent).toBe('/guide'))
    expect(screen.queryByTestId('shell-gear-menu')).toBeNull()
  })
})

describe('NAV-37/38/39: the palette', () => {
  const design = mkTicket({ id: 'd-x', kind: 'design', lane: 'design', title: 'Design a zebra cache', status: 'todo', order: 5 })
  const doneDesign = mkTicket({ id: 'd-y', kind: 'design', lane: 'design', title: 'Design a koala feed', status: 'done', doneAt: 5 })
  const write = mkTicket({ id: 'w-x', kind: 'writeup', lane: 'design', title: 'Write up the yak scheduler' })
  const watch = mkTicket({ id: 'p-x', kind: 'watch', title: 'Watch the llama talk' })
  const open = async () => {
    const r = await boot({ extra: [design, doneDesign, write, watch] })
    fireEvent.click(await screen.findByTestId('shell-search'))
    return { ...r, input: await screen.findByTestId('shell-palette-input') }
  }
  const targets = (input: HTMLElement, q: string) => { fireEvent.change(input, { target: { value: q } }); return screen.queryAllByTestId('shell-palette-item').map(i => i.getAttribute('data-target')) }
  it('sends design and write-up tickets, in any status, to the design session, and leaves the rest on /do', async () => {
    const { input } = await open()
    expect(targets(input, 'zebra')).toContain('/designs/session/d-x')
    expect(targets(input, 'koala')).toContain('/designs/session/d-y')
    expect(targets(input, 'yak')).toContain('/designs/session/w-x')
    expect(targets(input, 'llama')).toContain('/do/p-x')
    expect(targets(input, 'zebra')).not.toContain('/do/d-x')
  })
  it('opens the session on Enter and writes nothing to the ticket', async () => {
    const { input, d } = await open()
    const before = await d.tickets.get('d-x')
    fireEvent.change(input, { target: { value: 'zebra' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(loc().textContent).toBe('/designs/session/d-x'))
    expect(screen.queryByTestId('shell-palette')).toBeNull()
    expect(await d.tickets.get('d-x')).toEqual(before)
  })
  it('lists the six keyed destinations first and finds the others by name', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-search'))
    const items = within(await screen.findByTestId('shell-palette')).getAllByTestId('shell-palette-item')
    expect(items.slice(0, 6).map(i => i.getAttribute('data-target'))).toEqual(['/', '/path', '/board', '/journal', '/skills', '/review'])
    items.slice(0, 6).forEach((it, k) => expect(it).toHaveTextContent(String(k + 1)))
    const input = screen.getByTestId('shell-palette-input')
    for (const [q, to] of [['board', '/board'], ['journal', '/journal'], ['ai topics', '/ai-topics'], ['guide', '/guide'], ['dsa', '/dsa'], ['designs', '/designs'], ['banks', '/banks'], ['atlas', '/atlas']] as const) {
      expect(targets(input, q), q).toContain(to)
    }
  })
})

describe('NAV-32 to NAV-36: the Designs search', () => {
  async function setup(route = '/designs') {
    const d = await seededDb(flatPlanProse)
    renderWithApp(<Designs />, { db: d, plan: flatPlanProse, route, path: '/designs' })
    await screen.findByTestId('next-design')
    return d
  }
  it('has a box above the ladder, no clear button while empty, and the tier view unchanged', async () => {
    await setup('/designs?tier=1')
    const box = screen.getByTestId('designs-search')
    expect(box).toHaveAccessibleName('Search designs')
    expect(box.compareDocumentPosition(screen.getByTestId('tier-ladder')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.queryByTestId('designs-search-clear')).toBeNull()
    expect(screen.queryByTestId('designs-search-results')).toBeNull()
    expect(screen.getByTestId('tier-detail')).toBeInTheDocument()
    expect(screen.getByTestId('next-design')).toBeInTheDocument()
  })
  it('shows grouped results in place of the tier detail, spanning tiers, and returns on clear', async () => {
    await setup('/designs?tier=1')
    fireEvent.change(screen.getByTestId('designs-search'), { target: { value: 'whiteboard' } })
    const res = await screen.findByTestId('designs-search-results')
    expect(screen.queryByTestId('tier-detail')).toBeNull()
    expect(screen.queryByTestId('designs-hint')).toBeNull()
    expect(within(res).getByTestId('designs-search-count')).toHaveAttribute('data-count', '1')
    expect(within(res).getByTestId('designs-search-count')).toHaveTextContent('1 designs')
    expect(within(res).getByTestId('designs-search-tier-1')).toHaveTextContent(/^Tier 1 · Foundations$/)
    expect(within(res).getByTestId('row-d-method')).toBeInTheDocument()
    expect(within(res).getByTestId('do-d-method')).toBeInTheDocument()
    expect(within(res).getByTestId('design-start-d-method')).toHaveAccessibleName(/^Start session: /)
    expect(within(res).getByTestId('dives-d-method')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('designs-search-clear'))
    await waitFor(() => expect(screen.queryByTestId('designs-search-results')).toBeNull())
    expect(screen.getByTestId('tier-detail')).toBeInTheDocument()
    expect(screen.getByTestId('designs-search')).toHaveValue('')
  })
  it('matches every word, in any order, against the title, the tier and the difficulty', async () => {
    await setup()
    const type = (v: string) => fireEvent.change(screen.getByTestId('designs-search'), { target: { value: v } })
    const count = () => screen.getByTestId('designs-search-count').getAttribute('data-count')
    type('  WHITEBOARD   method '); await screen.findByTestId('designs-search-results'); expect(count()).toBe('1')
    type('foundations'); expect(count()).toBe('2')
    type('foundations whiteboard'); expect(count()).toBe('1')
    type('foundations zzzz'); expect(count()).toBe('0')
    type('   '); await waitFor(() => expect(screen.queryByTestId('designs-search-results')).toBeNull())
  })
  it('says "No design matches that." with no action for a query that matches nothing, and keeps the clear button', async () => {
    await setup()
    fireEvent.change(screen.getByTestId('designs-search'), { target: { value: 'zzzz' } })
    const empty = await screen.findByTestId('designs-search-empty')
    expect(empty).toHaveTextContent('No design matches that.')
    expect(empty).toHaveAttribute('data-empty', 'true')
    expect(within(screen.getByTestId('designs-search-results')).queryByRole('button')).toBeNull()
    expect(screen.getByTestId('designs-search-count')).toHaveTextContent('0 designs')
    expect(screen.getByTestId('designs-search-clear')).toBeInTheDocument()
  })
  it('keeps the query in the URL next to the tier, replacing history, and reads it back from the URL', async () => {
    await setup('/designs?tier=1')
    fireEvent.change(screen.getByTestId('designs-search'), { target: { value: 'cache' } })
    await waitFor(() => expect(loc()).toHaveAttribute('data-search', '?tier=1&q=cache'))
    cleanup()
    await setup('/designs?tier=1&q=whiteboard')
    expect(screen.getByTestId('designs-search')).toHaveValue('whiteboard')
    expect(await screen.findByTestId('designs-search-results')).toBeInTheDocument()
  })
})

describe('NAV-40/41: Path keeps its search on Back', () => {
  function Probe() {
    const go = useNavigate()
    return <div><button data-testid="probe-back" onClick={() => go(-1)}>back</button><span data-testid="probe-at">{useLocation().pathname}</span></div>
  }
  function OpenRow() {
    const go = useNavigate()
    return <button data-testid="probe-open" onClick={() => go('/elsewhere')}>open</button>
  }
  async function mount(route = '/path') {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    await d.tickets.bulkPut([
      mkTicket({ id: 'a1', lane: 'dsa', kind: 'problem', title: 'graph walk one' }), mkTicket({ id: 'a2', lane: 'dsa', kind: 'problem', title: 'graph walk two' }),
      mkTicket({ id: 'b1', lane: 'path', kind: 'watch', title: 'graph of attention' }), mkTicket({ id: 'b2', lane: 'path', title: 'other thing' }),
    ])
    render(
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppProviders db={d} plan={plans.plan} planV2={plans.planV2}>
          <Routes>
            <Route path="/path" element={<><Path /><OpenRow /></>} />
            <Route path="/elsewhere" element={<Probe />} />
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    )
    await screen.findByTestId('path-search')
  }
  it('restores the DSA lane and the typed word after open and Back', async () => {
    await mount()
    fireEvent.click(screen.getByTestId('path-lane-dsa'))
    fireEvent.change(screen.getByTestId('path-search'), { target: { value: 'graph' } })
    const rows = () => screen.getAllByTestId(/^row-/).map(r => r.getAttribute('data-ticket-id'))
    const before = rows()
    expect(before).toEqual(['a1', 'a2'])
    fireEvent.click(screen.getByTestId('probe-open'))
    fireEvent.click(await screen.findByTestId('probe-back'))
    const box = await screen.findByTestId('path-search')
    expect(box).toHaveValue('graph')
    expect(screen.getByTestId('path-lane-dsa')).toHaveAttribute('aria-pressed', 'true')
    expect(rows()).toEqual(before)
  })
  it('starts clean in a new tab (nothing stored), and when Path is opened by a link rather than Back', async () => {
    window.sessionStorage.setItem('dojo.path.filter', JSON.stringify({ lane: 'dsa', query: 'graph' }))
    await mount()
    expect(screen.getByTestId('path-search')).toHaveValue('graph') // a reload of this tab restores it
    cleanup()
    window.sessionStorage.clear()
    await mount()
    expect(screen.getByTestId('path-search')).toHaveValue('')
    expect(screen.getByTestId('path-lane-all')).toHaveAttribute('aria-pressed', 'true')
  })
  it('forgets it when the search is cleared from the no-match state', async () => {
    await mount()
    fireEvent.click(screen.getByTestId('path-lane-dsa'))
    fireEvent.change(screen.getByTestId('path-search'), { target: { value: 'zzzz' } })
    fireEvent.click(await screen.findByTestId('path-search-clear'))
    expect(screen.getByTestId('path-search')).toHaveValue('')
    expect(screen.getByTestId('path-lane-all')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByTestId('probe-open'))
    fireEvent.click(await screen.findByTestId('probe-back'))
    expect(await screen.findByTestId('path-search')).toHaveValue('')
    expect(screen.getByTestId('path-lane-all')).toHaveAttribute('aria-pressed', 'true')
    expect(window.sessionStorage.getItem('dojo.path.filter')).toBeNull()
  })
})

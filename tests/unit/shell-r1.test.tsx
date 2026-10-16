import { existsSync, readFileSync } from 'node:fs'
import { cleanup, render, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../src/app/App'
import { Shell } from '../../src/app/Shell'
import { StartGate } from '../../src/app/StartGate'
import { getSettings, patchSettings } from '../../src/data/db'
import type { PlanJson, Redo } from '../../src/data/types'
import { NARROW_QUERY } from '../../src/lib/useMediaQuery'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const plans = appPlans()
const NOW = Date.now()
const redo = (n: number): Redo => ({ id: `r${n}`, ticketId: `w${n}`, source: 'check_failed', createdAt: NOW - 9e8, stage: 0, due: NOW - 86_400_000, passed: [], helpCost: 0, refunded: 0 })

async function boot(opts: { route?: string; settings?: Record<string, unknown>; due?: number; v1?: PlanJson; extra?: ReturnType<typeof mkTicket>[] } = {}) {
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0, ...opts.settings })
  const ts = Array.from({ length: opts.due ?? 0 }, (_, i) => mkTicket({ id: `w${i}`, kind: 'watch', title: `Watch ${i}`, xp: 10, status: 'done' }))
  await d.tickets.bulkPut([mkTicket({ id: 'open1', title: 'Watch Karpathy attention', xp: 0 }), ...ts, ...(opts.extra ?? [])])
  if (opts.due) await d.redos.bulkPut(ts.map((_, i) => redo(i)))
  const r = renderWithApp(<Shell />, { db: d, ...(opts.v1 ? { plan: opts.v1 } : plans), route: opts.route ?? '/' })
  return { d, ...r }
}
const loc = () => screen.getByTestId('location')
afterEach(() => { vi.unstubAllGlobals(); window.location.hash = '' })

describe('shell: destinations', () => {
  it('has thirteen items in order, no More menu, Today current', async () => {
    await boot()
    const rail = await screen.findByTestId('shell-rail')
    const items = within(rail).getAllByTestId(/^shell-nav-/)
    expect(items.map(i => i.getAttribute('data-testid'))).toEqual(['today', 'path', 'board', 'journal', 'skills', 'review', 'ai', 'dsa', 'designs', 'banks', 'atlas', 'portfolio', 'guide'].map(i => `shell-nav-${i}`))
    expect(screen.getByTestId('shell-nav-today')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByTestId('more-button')).toBeNull()
    expect(screen.queryByTestId('keys-legend')).toBeNull()
    expect(within(rail).getByTestId('logo-cube')).toBeInTheDocument()
    for (const i of items) expect(i).toHaveAccessibleName()
  })

  it('shows labels on the first load and hides them from the next (hover is stored at once)', async () => {
    const { d } = await boot()
    expect(await screen.findByTestId('shell-rail')).toHaveAttribute('data-expanded', 'true')
    await waitFor(async () => expect((await getSettings(d)).navLabels).toBe('hover'))
    expect(screen.getByTestId('shell-rail')).toHaveAttribute('data-expanded', 'true') // the whole first page load keeps them
    cleanup()
    renderWithApp(<Shell />, { db: d, ...plans })
    await waitFor(() => expect(screen.getByTestId('shell-rail')).toHaveAttribute('data-expanded', 'false'))
    expect((await getSettings(d)).navLabels).toBe('hover')
  })

  it('follows the Settings switch at once', async () => {
    const { d } = await boot({ settings: { navLabels: 'hover' } })
    expect(await screen.findByTestId('shell-rail')).toHaveAttribute('data-expanded', 'false')
    await patchSettings(d, { navLabels: 'always' })
    await waitFor(() => expect(screen.getByTestId('shell-rail')).toHaveAttribute('data-expanded', 'true'))
  })

  it('keeps the rail at 200 px with labels on a ticket and a design session too (no work-route exception)', async () => {
    for (const route of ['/do/open1', '/designs/session/d1']) {
      cleanup()
      await boot({ route, settings: { navLabels: 'always' } })
      expect(await screen.findByTestId('shell-rail'), route).toHaveAttribute('data-expanded', 'true')
    }
  })

  it('counts due reviews on the Review item, and hides the badge at zero', async () => {
    await boot({ due: 6 })
    const badge = await screen.findByTestId('shell-review-badge')
    expect(badge).toHaveTextContent('6')
    expect(badge).toHaveAttribute('data-count', '6')
    expect(screen.getByTestId('shell-nav-review')).toContainElement(badge)
    cleanup()
    await boot({ due: 0 })
    await screen.findByTestId('shell-rail')
    expect(screen.queryByTestId('shell-review-badge')).toBeNull()
  })

  it('draws the header with the gear, the search, level and XP and nothing else', async () => {
    await boot({ due: 3, extra: [mkTicket({ id: 'folded', xp: 50, mergedInto: 'open1' })] })
    const h = await screen.findByTestId('shell-header')
    for (const id of ['shell-gear', 'shell-search', 'level', 'xp-total']) expect(within(h).getByTestId(id)).toBeInTheDocument()
    // 3 finished tickets of 10 XP; the folded ticket's 50 XP is left out (README "Header numbers")
    await waitFor(() => expect(screen.getByTestId('xp-total')).toHaveAttribute('data-value', '30'))
    expect(within(h).getByTestId('level')).toHaveAttribute('data-value', '3') // Today's Pom card holds a second `level` (TODAY-50)
    expect(within(h).getByTestId('level')).toHaveTextContent(/^LV \d+$/)
    expect(screen.getByTestId('xp-total')).toHaveTextContent(/^\d+ XP$/)
    expect(h.textContent).not.toMatch(/\d{1,2}:\d{2}/)
    expect(h.textContent).not.toMatch(/streak/i)
    const numeric = Array.from(h.querySelectorAll('*')).filter(e => e.children.length === 0 && /\d/.test(e.textContent ?? ''))
    expect(numeric.map(e => e.getAttribute('data-testid')).sort()).toEqual(['level', 'xp-total'])
  })

  it('shows a placeholder, with no data-value, until the learner data has loaded, then the real numbers', async () => {
    await boot({ due: 3 })
    // the first paint, before the live query has answered: the hooks are there, neutral, and carry no number to poll
    const lv = within(screen.getByTestId('shell-header')).getByTestId('level'); const xp = screen.getByTestId('xp-total')
    expect(lv).toHaveTextContent('LV –'); expect(xp).toHaveTextContent('– XP')
    expect(lv).not.toHaveAttribute('data-value'); expect(xp).not.toHaveAttribute('data-value')
    await waitFor(() => expect(xp).toHaveAttribute('data-value', '30'))
    expect(xp).toHaveTextContent('30 XP')
    expect(lv).toHaveAttribute('data-value', '3'); expect(lv).toHaveTextContent('LV 3')
  })

  it('draws the heading of the screen in the header, except where the screen draws its own', async () => {
    await boot({ route: '/settings' })
    expect(await within(await screen.findByTestId('shell-header')).findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument()
    cleanup()
    await boot({ route: '/do/open1' })
    await screen.findByTestId('shell-rail')
    expect(within(screen.getByTestId('shell-header')).queryByRole('heading')).toBeNull()
    expect(screen.getByTestId('shell-header')).toHaveTextContent('Ticket')
  })

  it('puts no tabindex on the content container and no session strip on a ticket', async () => {
    await boot({ route: '/do/open1' })
    await screen.findByTestId('shell-rail')
    const main = document.querySelector('main.sh-main')!
    expect(main).not.toHaveAttribute('tabindex')
    expect(main).toHaveAttribute('data-work', 'true')
    expect(screen.queryByTestId('session-strip')).toBeNull()
  })

  it('uses the bottom tab bar on a phone, with the gear and search still in the header', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === NARROW_QUERY, media: q, addEventListener() {}, removeEventListener() {} }))
    await boot({ due: 2 })
    const bar = await screen.findByTestId('shell-tabbar')
    expect(screen.queryByTestId('shell-rail')).toBeNull()
    expect(within(bar).getAllByTestId(/^shell-nav-/)).toHaveLength(4)
    for (const n of ['Today', 'Path', 'Board', 'Review', 'More']) expect(within(bar).getByText(n)).toBeInTheDocument()
    expect(await within(bar).findByTestId('shell-review-badge')).toHaveAttribute('data-count', '2')
    expect(screen.getByTestId('shell-gear')).toBeInTheDocument()
    expect(screen.getByTestId('shell-search')).toBeInTheDocument()
  })

  it('has no current item on a ticket, a design session or Settings, and its own on Guide and the topic and practice screens', async () => {
    for (const route of ['/do/open1', '/designs/session/d1', '/settings']) {
      cleanup()
      await boot({ route })
      await screen.findByTestId('shell-rail')
      expect(document.querySelectorAll('[aria-current="page"]'), route).toHaveLength(0)
    }
    for (const [route, id] of [['/guide', 'guide'], ['/dsa', 'dsa'], ['/designs', 'designs'], ['/atlas', 'atlas'], ['/portfolio', 'portfolio'], ['/banks', 'banks']] as const) {
      cleanup()
      await boot({ route, v1: id === 'guide' ? undefined : flatPlanV2 })
      await screen.findByTestId('shell-rail')
      expect(Array.from(document.querySelectorAll('[aria-current="page"]')).map(e => e.getAttribute('data-testid')), route).toEqual([`shell-nav-${id}`])
    }
  })

  it('marks Skills current on its sub-routes', async () => {
    for (const route of ['/skills', '/skills/area/llm', '/skills/stats']) {
      cleanup()
      await boot({ route })
      await screen.findByTestId('shell-rail')
      expect(screen.getByTestId('shell-nav-skills'), route).toHaveAttribute('aria-current', 'page')
    }
  })
})

describe('shell: sizes (SHELL-03, 07, 10, 12)', () => {
  const css = readFileSync('src/app/shell/shell.css', 'utf8')
  it('declares the rail at 56 and 200 px, the header at 48 px and the phone bar at 68 px', () => {
    expect(css).toMatch(/\.sh-rail \{[^}]*width: 56px/)
    expect(css).toMatch(/\.sh-rail\[data-expanded='true'\] \{ width: 200px/)
    expect(css).toMatch(/\.sh-header \{[^}]*height: 48px/)
    expect(css).toMatch(/\.sh-tabbar \{[^}]*height: 68px/)
  })
  it('shows a hidden label on hover and on focus (:focus as well as :focus-visible)', () => {
    expect(css).toMatch(/\.sh-ri:hover \.sh-rl/)
    expect(css).toMatch(/\.sh-ri:focus \.sh-rl/)
    expect(css).toMatch(/\.sh-ri:focus-visible \.sh-rl/)
  })
  it('gives no header or shell button a blue-hue fill (TODAY-31): the search is transparent', () => {
    expect(css).toMatch(/\.sh-search \{[^}]*background: transparent/)
    expect(css).toMatch(/\.sh-ibtn \{[^}]*background: transparent/)
  })
  it('draws the current rail item and tab with no tile fill (TODAY-31): transparent, the accent edge and the inset bevel', () => {
    for (const sel of ['\\.sh-ri\\.on', '\\.sh-tb\\.on']) {
      const rule = css.match(new RegExp(`${sel} \\{([^}]*)\\}`))?.[1] ?? ''
      expect(rule, sel).toMatch(/background: transparent/)
      expect(rule, sel).not.toMatch(/surface-tile\)?;|background: var\(--sr-surface/)
      expect(rule, sel).toMatch(/--sr-energy-accent/)
      expect(rule, sel).toMatch(/box-shadow: inset 2px 2px 0/)
    }
  })
  it('keeps a design session inside the chrome: its full-height wrappers shrink by the header', () => {
    expect(css).toMatch(/\.sh-main\[data-work='true'\] \.ds[^{]*\{[^}]*calc\(100dvh - var\(--sh-chrome\) - var\(--sh-pad-y\)\)/)
  })
})

describe('shell: keys (Review Focus 2)', () => {
  it('1 to 6 switch destinations from the page body (Board and Journal have no screen on this branch and fall back to Today)', async () => {
    await boot()
    await screen.findByTestId('shell-rail')
    for (const [k, to] of [['2', '/path'], ['5', '/skills'], ['6', '/review'], ['1', '/']] as const) {
      fireEvent.keyDown(document.body, { key: k })
      await waitFor(() => expect(loc()).toHaveTextContent(new RegExp(`^${to}$`)))
    }
  })

  it('still navigates from a ticket', async () => {
    await boot({ route: '/do/open1' })
    await screen.findByTestId('shell-rail')
    fireEvent.keyDown(document.body, { key: '5' })
    await waitFor(() => expect(loc()).toHaveTextContent(/^\/skills$/))
  })

  it('types a digit in a text field instead of navigating', async () => {
    await boot({ route: '/path' })
    const box = await screen.findByTestId('path-search')
    fireEvent.keyDown(box, { key: '2' })
    fireEvent.keyDown(box, { key: '4' })
    expect(loc()).toHaveTextContent(/^\/path$/)
  })

  it('ignores the canvas region and modified presses', async () => {
    await boot()
    await screen.findByTestId('shell-rail')
    const canvas = document.createElement('div')
    canvas.setAttribute('data-testid', 'kit-canvas')
    canvas.tabIndex = 0
    const inner = document.createElement('span')
    canvas.appendChild(inner)
    document.body.appendChild(canvas)
    const notes = document.createElement('div')
    notes.setAttribute('data-no-global-keys', '')
    document.body.appendChild(notes)
    for (const el of [inner, notes]) { fireEvent.keyDown(el, { key: '3' }); fireEvent.keyDown(el, { key: '?' }) }
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) fireEvent.keyDown(document.body, { key: '3', ...mod })
    await new Promise(r => setTimeout(r, 30))
    expect(loc()).toHaveTextContent(/^\/$/)
    expect(screen.queryByTestId('shell-shortcuts')).toBeNull()
  })

  it('opens the shortcuts overlay on ?, lists the keys, closes on Esc, and ignores ? in a field', async () => {
    await boot({ route: '/path' })
    const box = await screen.findByTestId('path-search')
    expect(screen.queryByRole('dialog')).toBeNull() // neither overlay is in the DOM while closed
    fireEvent.keyDown(box, { key: '?' })
    expect(screen.queryByTestId('shell-shortcuts')).toBeNull()
    fireEvent.keyDown(document.body, { key: '?' })
    const o = await screen.findByTestId('shell-shortcuts')
    expect(o).toHaveAttribute('role', 'dialog')
    for (const t of ['1', 'Ctrl/Cmd+K', '?', 'Enter', 'Esc', 'N', 'C', 'T', 'G']) expect(o.textContent).toContain(t)
    fireEvent.keyDown(o, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('shell-shortcuts')).toBeNull())
  })
})

describe('shell: palette', () => {
  it('opens on Ctrl+K even inside a field, lists the destinations with keys, and returns focus on Esc', async () => {
    await boot({ route: '/path' })
    const box = await screen.findByTestId('path-search')
    box.focus()
    fireEvent.keyDown(box, { key: 'k', ctrlKey: true })
    const p = await screen.findByTestId('shell-palette')
    expect(p).toHaveAttribute('role', 'dialog')
    expect(screen.getByTestId('shell-palette-input')).toHaveFocus()
    const first = within(p).getAllByTestId('shell-palette-item').slice(0, 6)
    expect(first.map(i => i.getAttribute('data-target'))).toEqual(['/', '/path', '/board', '/journal', '/skills', '/review'])
    expect(first[1]).toHaveTextContent('2')
    expect(first[0]).toHaveAttribute('aria-selected', 'true') // highlighted as soon as the list renders
    expect(first[0]).toHaveAttribute('data-kind')
    fireEvent.keyDown(p, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('shell-palette')).toBeNull())
    expect(box).toHaveFocus()
  })

  it('reaches tickets, skills, pages and legacy screens, and navigates with the keyboard', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-search'))
    const input = await screen.findByTestId('shell-palette-input')
    const targetsFor = (q: string) => { fireEvent.change(input, { target: { value: q } }); return screen.queryAllByTestId('shell-palette-item').map(i => i.getAttribute('data-target')) }
    expect(targetsFor('karpathy')).toContain('/do/open1')
    expect(targetsFor('How LLMs')).toContain('/skills/area/llm')
    for (const [q, to] of [['review', '/review'], ['settings', '/settings'], ['guide', '/guide'], ['path', '/path'], ['atlas', '/atlas'], ['banks', '/banks'], ['dsa', '/dsa'], ['designs', '/designs']] as const) expect(targetsFor(q), q).toContain(to)
    fireEvent.change(input, { target: { value: 'guide' } })
    expect(screen.getAllByTestId('shell-palette-item')[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(loc()).toHaveTextContent(/^\/guide$/))
    expect(screen.queryByTestId('shell-palette')).toBeNull()
  })

  it('moves the highlight by one, stops at the ends, and Enter opens the highlighted result', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-search'))
    const input = await screen.findByTestId('shell-palette-input')
    const sel = () => screen.getAllByTestId('shell-palette-item').findIndex(i => i.getAttribute('aria-selected') === 'true')
    expect(sel()).toBe(0)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(sel()).toBe(0)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(sel()).toBe(1)
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(sel()).toBe(2)
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(sel()).toBe(1)
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(loc()).toHaveTextContent(/^\/path$/))
    expect(screen.queryByTestId('shell-palette')).toBeNull()
  })

  it('says one sentence and offers no action when nothing matches', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-search'))
    fireEvent.change(await screen.findByTestId('shell-palette-input'), { target: { value: 'zzzqq' } })
    const p = screen.getByTestId('shell-palette')
    expect(within(p).queryAllByTestId('shell-palette-item')).toHaveLength(0)
    expect(p.querySelectorAll('p')).toHaveLength(1)
    const empty = within(p).getByTestId('shell-palette-empty')
    expect(empty.textContent).toBe('Nothing matches.')
    expect(empty).toHaveAttribute('data-empty', 'true')
    expect(p.querySelectorAll('a, button')).toHaveLength(0)
  })

  it('keeps digits in its input: typing 2 there does not navigate', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-search'))
    const input = await screen.findByTestId('shell-palette-input')
    fireEvent.keyDown(input, { key: '2' })
    await new Promise(r => setTimeout(r, 30))
    expect(loc()).toHaveTextContent(/^\/$/)
  })
})

describe('shell: gear menu', () => {
  it('opens Settings, Guide and Shortcuts, and closes on Esc', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-gear'))
    const m = screen.getByTestId('shell-gear-menu')
    for (const id of ['shell-menu-settings', 'shell-menu-guide', 'shell-menu-shortcuts']) expect(within(m).getByTestId(id)).toBeInTheDocument()
    expect(within(m).getByTestId('shell-menu-settings')).toHaveAttribute('href', '/settings')
    expect(within(m).getByTestId('shell-menu-guide')).toHaveAttribute('href', '/guide')
    fireEvent.keyDown(m, { key: 'Escape' })
    expect(screen.queryByTestId('shell-gear-menu')).toBeNull()
    expect(screen.getByTestId('shell-gear')).toHaveFocus()
    fireEvent.click(screen.getByTestId('shell-gear'))
    fireEvent.click(screen.getByTestId('shell-menu-shortcuts'))
    expect(await screen.findByTestId('shell-shortcuts')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByTestId('shell-shortcuts'), { key: 'Escape' })
    fireEvent.click(screen.getByTestId('shell-gear'))
    fireEvent.click(screen.getByTestId('shell-menu-guide'))
    await waitFor(() => expect(loc()).toHaveTextContent(/^\/guide$/))
    fireEvent.click(screen.getByTestId('shell-gear'))
    fireEvent.click(screen.getByTestId('shell-menu-settings'))
    await waitFor(() => expect(loc()).toHaveTextContent(/^\/settings$/))
  })
})

describe('shell: plan changed notice', () => {
  const replan = { t: 'replan', at: 5, report: {} } as never
  it('shows once after a migration, then never again, and writes nothing to the database', async () => {
    const { d } = await boot({ settings: { flatMigratedAt: 5, modelVersion: 2 } })
    await d.events.add(replan)
    const n = await screen.findByTestId('shell-plan-changed')
    expect(n.textContent).toMatch(/plan changed/i)
    fireEvent.click(screen.getByTestId('shell-plan-changed-dismiss'))
    expect(screen.queryByTestId('shell-plan-changed')).toBeNull()
    cleanup()
    renderWithApp(<Shell />, { db: d, ...plans })
    await screen.findByTestId('shell-rail')
    expect(screen.queryByTestId('shell-plan-changed')).toBeNull()
  })
  it('stays on screen while the learner moves between destinations (mounted once, in the shell)', async () => {
    const { d } = await boot({ settings: { flatMigratedAt: 5, modelVersion: 2 } })
    await d.events.add(replan)
    await screen.findByTestId('shell-plan-changed')
    fireEvent.keyDown(document.body, { key: '2' })
    await waitFor(() => expect(loc()).toHaveTextContent(/^\/path$/))
    expect(screen.getByTestId('shell-plan-changed')).toBeInTheDocument()
  })
  it('does not show on a database that was never migrated', async () => {
    await boot()
    await screen.findByTestId('shell-rail')
    expect(screen.queryByTestId('shell-plan-changed')).toBeNull()
  })
})

describe('shell: onboarding (SHELL-27)', () => {
  async function fresh() {
    const d = freshDb()
    await d.settings.put({ id: 'main', startDate: '', planVersion: 't', aiProviders: {}, possibleXp: 0 })
    renderWithApp(<StartGate><Shell /></StartGate>, { db: d, ...plans })
    return d
  }
  it('shows onboarding with no rail, tab bar or palette, and Ctrl+K opens nothing', async () => {
    await fresh()
    expect(await screen.findByTestId('screen-onboarding')).toBeInTheDocument()
    expect((screen.getByTestId('onboarding-start-date') as HTMLInputElement).value).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const go = screen.getByTestId('onboarding-submit')
    expect(go).toHaveTextContent('START · PLAN')
    expect(go).toHaveAttribute('data-accent', 'primary')
    for (const id of ['shell-rail', 'shell-tabbar', 'shell-palette', 'shell-header', 'shell-search']) expect(screen.queryByTestId(id), id).toBeNull()
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: '2' })
    await new Promise(r => setTimeout(r, 30))
    expect(screen.queryByTestId('shell-palette')).toBeNull()
    expect(screen.getByTestId('screen-onboarding')).toBeInTheDocument()
  })
  it('an empty date shows form-error and stays', async () => {
    await fresh()
    fireEvent.change(await screen.findByTestId('onboarding-start-date'), { target: { value: '' } })
    fireEvent.click(screen.getByTestId('onboarding-submit'))
    expect(await screen.findByTestId('form-error')).toBeInTheDocument()
    expect(screen.getByTestId('screen-onboarding')).toBeInTheDocument()
    expect(screen.queryByTestId('shell-rail')).toBeNull()
  })
  it('a valid date opens Today with the rail at its label width, and stores the date', async () => {
    const d = await fresh()
    fireEvent.change(await screen.findByTestId('onboarding-start-date'), { target: { value: '2026-11-02' } })
    fireEvent.click(screen.getByTestId('onboarding-submit'))
    expect(await screen.findByTestId('screen-today')).toBeInTheDocument()
    expect(await screen.findByTestId('shell-rail')).toHaveAttribute('data-expanded', 'true')
    expect((await getSettings(d)).startDate).toBe('2026-11-02')
    await waitFor(async () => expect((await getSettings(d)).navLabels).toBe('hover'))
  })
})

const partnerGate = existsSync('src/screens/designSession/partner/partnerRoute.ts')
describe.skipIf(!partnerGate)('S8 partner card gate (kept working)', () => {
  it('renders the card, not the shell, for #/partner/<id>', async () => {
    window.location.hash = '#/partner/ds-none'
    const serve: typeof fetch = (async () => ({ ok: true, status: 200, json: async () => flatPlanV2 }) as unknown as Response)
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><App database={freshDb()} fetcher={serve} /></MemoryRouter>)
    expect(await screen.findByTestId('screen-partner')).toBeInTheDocument()
    expect(screen.queryByTestId('shell-rail')).toBeNull()
    expect(screen.queryByTestId('shell-tabbar')).toBeNull()
  })
})

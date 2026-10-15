import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Shell } from '../../src/app/Shell'
import { getSettings } from '../../src/data/db'
import { safeWrite } from '../../src/data/safeWrite'
import type { PlanJson } from '../../src/data/types'
import { NARROW_QUERY } from '../../src/lib/useMediaQuery'
import { freshDb } from '../helpers/db'
import { flatPlanV2 } from '../helpers/plan'
import { appPlans, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const hoisted = vi.hoisted(() => ({ failNavLabels: false }))
vi.mock('../../src/data/settingsActions', async importOriginal => {
  const orig = await importOriginal<typeof import('../../src/data/settingsActions')>()
  return { ...orig, saveNavLabels: (...a: Parameters<typeof orig.saveNavLabels>) => (hoisted.failNavLabels ? Promise.reject(new Error('disk full')) : orig.saveNavLabels(...a)) }
})

const plans = appPlans()
async function boot(opts: { route?: string; settings?: Record<string, unknown>; v1?: PlanJson; extra?: ReturnType<typeof mkTicket>[]; tickets?: ReturnType<typeof mkTicket>[] } = {}) {
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0, navLabels: 'hover', ...opts.settings })
  await d.tickets.bulkPut([...(opts.tickets ?? [mkTicket({ id: 'open1', title: 'Watch Karpathy attention', xp: 0 })]), ...(opts.extra ?? [])])
  const r = renderWithApp(<Shell />, { db: d, ...(opts.v1 ? { plan: opts.v1 } : plans), route: opts.route ?? '/' })
  return { d, ...r }
}
const loc = () => screen.getByTestId('location')
const phone = () => vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === NARROW_QUERY, media: q, addEventListener() {}, removeEventListener() {} }))
afterEach(() => { vi.unstubAllGlobals(); hoisted.failNavLabels = false; document.querySelectorAll('[data-test-extra]').forEach(n => n.remove()) })

describe('shell timing (R18): navigation is immediate, never behind a pending write', () => {
  // a write that never settles: the old waiting navigation would sit on it for 1.5 s
  const stall = () => { void safeWrite(() => new Promise<void>(() => {}), () => {}) }

  it('a rail click switches the screen in the same event', async () => {
    await boot()
    await screen.findByTestId('shell-rail')
    stall()
    fireEvent.click(screen.getByTestId('shell-nav-path'))
    expect(loc()).toHaveTextContent(/^\/path$/) // no waitFor: synchronous
  })

  it('a digit key switches the screen in the same event', async () => {
    await boot()
    await screen.findByTestId('shell-rail')
    stall()
    fireEvent.keyDown(document.body, { key: '5' })
    expect(loc()).toHaveTextContent(/^\/skills$/)
  })

  it('palette Enter switches the screen in the same event', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-search'))
    const input = await screen.findByTestId('shell-palette-input')
    fireEvent.change(input, { target: { value: 'guide' } })
    stall()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(loc()).toHaveTextContent(/^\/guide$/)
    expect(screen.queryByTestId('shell-palette')).toBeNull()
  })

  it('the gear links switch the screen in the same event', async () => {
    await boot()
    await screen.findByTestId('shell-rail')
    stall()
    fireEvent.click(screen.getByTestId('shell-gear'))
    fireEvent.click(screen.getByTestId('shell-menu-guide'))
    expect(loc()).toHaveTextContent(/^\/guide$/)
    fireEvent.click(screen.getByTestId('shell-gear'))
    fireEvent.click(screen.getByTestId('shell-menu-settings'))
    expect(loc()).toHaveTextContent(/^\/settings$/)
  })

  it('the shell no longer waits on writes at all', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of ['src/app/useGlobalKeys.ts', 'src/app/shell/Rail.tsx', 'src/app/shell/GearMenu.tsx', 'src/app/shell/Palette.tsx']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/useNavigateAfterWrites/)
    }
  })
})

describe('shell: rail items (aria-label, describedby, aria-keyshortcuts)', () => {
  it('names each item exactly after its destination and gives the Review count as its description', async () => {
    const due = Array.from({ length: 3 }, (_, i) => mkTicket({ id: `w${i}`, kind: 'watch', title: `Done ${i}`, xp: 10, status: 'done' }))
    const { d } = await boot({ extra: due })
    await d.redos.bulkPut(due.map((t, i) => ({ id: `r${i}`, ticketId: t.id, source: 'check_failed' as const, createdAt: 1, stage: 0, due: 1, passed: [], helpCost: 0, refunded: 0 })))
    const review = await screen.findByTestId('shell-nav-review')
    await waitFor(() => expect(screen.getByTestId('shell-nav-review')).toHaveAttribute('aria-describedby'))
    for (const [id, name, key] of [['today', 'Today', '1'], ['path', 'Path', '2'], ['board', 'Board', '3'], ['journal', 'Journal', '4'], ['skills', 'Skills', '5'], ['review', 'Review', '6']] as const) {
      const a = screen.getByTestId(`shell-nav-${id}`)
      expect(a).toHaveAccessibleName(name)
      expect(a.getAttribute('aria-label')).toBe(name)
      expect(a).toHaveAttribute('aria-keyshortcuts', key)
    }
    expect(review).toHaveAccessibleDescription('3 due')
    expect(screen.getByTestId('shell-nav-today')).not.toHaveAttribute('aria-describedby')
  })

  it('does the same in the phone tab bar', async () => {
    phone()
    await boot()
    const bar = await screen.findByTestId('shell-tabbar')
    const keys = within(bar).getAllByTestId(/^shell-nav-/).map(a => [a.getAttribute('aria-label'), a.getAttribute('aria-keyshortcuts')])
    expect(keys).toEqual([['Today', '1'], ['Path', '2'], ['Board', '3'], ['Review', '6']])
  })
})

describe('shell: header', () => {
  it('draws the logo cube in the header on a phone, once, and in the rail on a desktop, once', async () => {
    phone()
    await boot()
    await screen.findByTestId('shell-tabbar')
    expect(screen.getAllByTestId('logo-cube')).toHaveLength(1)
    expect(screen.getByTestId('shell-header')).toContainElement(screen.getByTestId('logo-cube'))
    cleanup()
    vi.unstubAllGlobals()
    await boot()
    await screen.findByTestId('shell-rail')
    expect(screen.getAllByTestId('logo-cube')).toHaveLength(1)
    expect(screen.getByTestId('shell-rail')).toContainElement(screen.getByTestId('logo-cube'))
  })

  it('shows no title of its own over a legacy screen: the screen has its one h1', async () => {
    for (const route of ['/dsa', '/designs', '/atlas', '/banks']) {
      cleanup()
      await boot({ route, v1: flatPlanV2 })
      await screen.findByTestId('shell-rail')
      const h = screen.getByTestId('shell-header')
      await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 }), route).toHaveLength(1))
      expect(h.querySelector('.sh-title'), route).toBeNull()
      expect(within(h).queryByRole('heading')).toBeNull()
      expect(h.contains(screen.getByRole('heading', { level: 1 }))).toBe(false)
    }
  })
})

describe('shell: gear menu', () => {
  it('has no theme toggle: only Settings, Guide and Shortcuts', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-gear'))
    const m = screen.getByTestId('shell-gear-menu')
    expect(within(m).getAllByRole('menuitem').map(i => i.getAttribute('data-testid'))).toEqual(['shell-menu-settings', 'shell-menu-guide', 'shell-menu-shortcuts'])
    expect(m.textContent).not.toMatch(/theme|dark|light/i)
    expect(within(m).queryByRole('switch')).toBeNull()
    expect(within(m).queryByRole('menuitemcheckbox')).toBeNull()
    expect(within(m).queryByRole('checkbox')).toBeNull()
  })

  it('closes when the route changes (a digit key moves on while it is open)', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-gear'))
    expect(screen.getByTestId('shell-gear-menu')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByTestId('shell-menu-settings'), { key: '2' })
    await waitFor(() => expect(loc()).toHaveTextContent(/^\/path$/))
    expect(screen.queryByTestId('shell-gear-menu')).toBeNull()
  })

  it('closes when focus leaves it, and stays open while focus moves inside it', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-gear'))
    const first = screen.getByTestId('shell-menu-settings')
    await waitFor(() => expect(first).toHaveFocus())
    act(() => screen.getByTestId('shell-menu-guide').focus())
    expect(screen.getByTestId('shell-gear-menu')).toBeInTheDocument()
    act(() => screen.getByTestId('shell-search').focus())
    await waitFor(() => expect(screen.queryByTestId('shell-gear-menu')).toBeNull())
  })

  it('stays open through a blur with no relatedTarget during a press inside it (Safari does not focus on mousedown), and the click navigates', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-gear'))
    const first = screen.getByTestId('shell-menu-settings')
    await waitFor(() => expect(first).toHaveFocus())
    const guide = screen.getByTestId('shell-menu-guide')
    fireEvent.mouseDown(guide)
    fireEvent.blur(first, { relatedTarget: null }) // the focused item blurs, nothing takes focus
    expect(screen.getByTestId('shell-gear-menu')).toBeInTheDocument()
    fireEvent.mouseUp(guide)
    fireEvent.click(guide)
    expect(loc()).toHaveTextContent(/^\/guide$/)
    expect(screen.queryByTestId('shell-gear-menu')).toBeNull()
  })

  it('still closes when focus leaves by Tab (blur with no relatedTarget and no press in progress), and after a finished press', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-gear'))
    const first = screen.getByTestId('shell-menu-settings')
    await waitFor(() => expect(first).toHaveFocus())
    fireEvent.mouseDown(first)
    fireEvent.mouseUp(first) // press over without a click (dragged away): the guard is released
    fireEvent.blur(first, { relatedTarget: null })
    await waitFor(() => expect(screen.queryByTestId('shell-gear-menu')).toBeNull())
    fireEvent.click(screen.getByTestId('shell-gear'))
    const again = screen.getByTestId('shell-menu-settings')
    await waitFor(() => expect(again).toHaveFocus())
    fireEvent.keyDown(again, { key: 'Tab' })
    act(() => screen.getByTestId('shell-search').focus()) // Tab out of the menu to the next control
    await waitFor(() => expect(screen.queryByTestId('shell-gear-menu')).toBeNull())
  })
})

describe('shell: shortcuts overlay', () => {
  it('keeps Tab inside the dialog (a focus trap)', async () => {
    await boot()
    await screen.findByTestId('shell-rail')
    fireEvent.keyDown(document.body, { key: '?' })
    const o = await screen.findByTestId('shell-shortcuts')
    const close = within(o).getByRole('button', { name: 'Close' })
    await waitFor(() => expect(o).toHaveFocus())
    expect(fireEvent.keyDown(o, { key: 'Tab', shiftKey: true })).toBe(false) // wraps to the last control
    expect(close).toHaveFocus()
    expect(fireEvent.keyDown(close, { key: 'Tab' })).toBe(false) // past the last control: wraps to the first, the Guide link
    expect(within(o).getByTestId('shell-shortcuts-guide')).toHaveFocus()
    expect(o.contains(document.activeElement)).toBe(true)
  })

  it('hands Ctrl+K to the palette instead of swallowing it, and Esc there returns focus to where the overlay was opened', async () => {
    await boot()
    const gear = await screen.findByTestId('shell-gear')
    fireEvent.click(gear)
    fireEvent.click(screen.getByTestId('shell-menu-shortcuts'))
    const o = await screen.findByTestId('shell-shortcuts')
    fireEvent.keyDown(o, { key: 'k', ctrlKey: true })
    const p = await screen.findByTestId('shell-palette')
    expect(screen.queryByTestId('shell-shortcuts')).toBeNull()
    expect(p).toBeInTheDocument()
    fireEvent.keyDown(p, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('shell-palette')).toBeNull())
    expect(gear).toHaveFocus()
  })

  it('also takes Cmd+K', async () => {
    await boot()
    await screen.findByTestId('shell-rail')
    fireEvent.keyDown(document.body, { key: '?' })
    fireEvent.keyDown(await screen.findByTestId('shell-shortcuts'), { key: 'k', metaKey: true })
    expect(await screen.findByTestId('shell-palette')).toBeInTheDocument()
    expect(screen.queryByTestId('shell-shortcuts')).toBeNull()
  })

  it('puts focus back on the gear after Esc when it was opened from the gear menu', async () => {
    await boot()
    const gear = await screen.findByTestId('shell-gear')
    fireEvent.click(gear)
    fireEvent.click(screen.getByTestId('shell-menu-shortcuts'))
    const o = await screen.findByTestId('shell-shortcuts')
    expect(screen.queryByTestId('shell-gear-menu')).toBeNull()
    fireEvent.keyDown(o, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByTestId('shell-shortcuts')).toBeNull())
    await waitFor(() => expect(gear).toHaveFocus())
  })

  const keysOf = async (route: string) => {
    cleanup()
    await boot({ route })
    await screen.findByTestId('shell-rail')
    fireEvent.keyDown(document.body, { key: '?' })
    const o = await screen.findByTestId('shell-shortcuts')
    return { o, here: Array.from(o.querySelectorAll('.sh-sl li')).map(li => li.textContent) }
  }

  it('lists under "On this screen" only the keys that screen answers (Today with a ticket: Enter start)', async () => {
    const { o, here } = await keysOf('/')
    await waitFor(() => expect(Array.from(o.querySelectorAll('.sh-sl li')).map(li => li.textContent)).toEqual(['Enter start']))
    expect(here).toBeDefined()
    expect(within(o).getByText('On this screen')).toBeInTheDocument()
    expect(o.querySelector('.sh-sl')!.textContent).not.toMatch(/space|slide|done|timer/i)
  })

  it('lists no screen keys on Path, Skills and Review (nothing there answers a key of its own)', async () => {
    for (const route of ['/path', '/skills', '/review']) {
      const { o, here } = await keysOf(route)
      expect(here, route).toEqual([])
      expect(within(o).queryByText('On this screen'), route).toBeNull()
    }
  })

  it('drops the screen keys again when the screen is left', async () => {
    await boot()
    await screen.findByTestId('shell-rail')
    fireEvent.keyDown(document.body, { key: '2' })
    await waitFor(() => expect(loc()).toHaveTextContent(/^\/path$/))
    fireEvent.keyDown(document.body, { key: '?' })
    const o = await screen.findByTestId('shell-shortcuts')
    expect(within(o).queryByText('On this screen')).toBeNull()
  })

  it('Today with nothing to start claims no Enter', async () => {
    await boot({ tickets: [] })
    await screen.findByTestId('shell-rail')
    fireEvent.keyDown(document.body, { key: '?' })
    const o = await screen.findByTestId('shell-shortcuts')
    expect(o.querySelector('.sh-sl')).toBeNull()
  })
})

describe('shell: Today ignores keys it does not answer', () => {
  it('Ctrl+Enter, Cmd+Enter, Space, d and s do nothing on Today; plain Enter starts the quest', async () => {
    const { d } = await boot()
    await screen.findByTestId('screen-today')
    await waitFor(() => expect(screen.getByTestId('shell-rail')).toBeInTheDocument())
    await screen.findByTestId('start-button')
    for (const k of [{ key: 'Enter', ctrlKey: true }, { key: 'Enter', metaKey: true }, { key: ' ' }, { key: 'd' }, { key: 's' }, { key: 'D' }, { key: 'S' }]) fireEvent.keyDown(document.body, k)
    await new Promise(r => setTimeout(r, 30))
    expect(loc()).toHaveTextContent(/^\/$/)
    expect((await d.tickets.get('open1'))?.status).toBe('todo')
    fireEvent.keyDown(document.body, { key: 'Enter' })
    await waitFor(() => expect(loc()).toHaveTextContent(/^\/do\/open1$/))
  })
})

describe('shell: global keys stay out from behind another dialog', () => {
  it.each([
    ['an open dialog', () => { const e = document.createElement('div'); e.setAttribute('role', 'dialog'); return e }],
    ['an open alert dialog', () => { const e = document.createElement('div'); e.setAttribute('role', 'alertdialog'); return e }],
    ['an aria-modal layer', () => { const e = document.createElement('div'); e.setAttribute('aria-modal', 'true'); return e }],
    ["Today's pick list", () => { const e = document.createElement('div'); e.setAttribute('data-testid', 'today-pick-list'); return e }],
  ])('1 to 6 and ? do nothing behind %s, and work again once it is gone', async (_n, make) => {
    await boot()
    await screen.findByTestId('shell-rail')
    const layer = make()
    layer.setAttribute('data-test-extra', '')
    document.body.appendChild(layer)
    for (const key of ['2', '3', '4', '5', '6', '?']) fireEvent.keyDown(document.body, { key })
    expect(loc()).toHaveTextContent(/^\/$/)
    expect(screen.queryByTestId('shell-shortcuts')).toBeNull()
    layer.remove()
    fireEvent.keyDown(document.body, { key: '2' })
    expect(loc()).toHaveTextContent(/^\/path$/)
  })

  it('Ctrl+K still opens the palette behind a dialog', async () => {
    await boot()
    await screen.findByTestId('shell-rail')
    const layer = document.createElement('div')
    layer.setAttribute('role', 'dialog')
    layer.setAttribute('data-test-extra', '')
    document.body.appendChild(layer)
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    expect(await screen.findByTestId('shell-palette')).toBeInTheDocument()
  })
})

describe('shell: rail labels write', () => {
  it('a failed write of the label setting raises no unhandled rejection', async () => {
    hoisted.failNavLabels = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const seen: unknown[] = []
    const onRej = (r: unknown) => { seen.push(r) }
    process.on('unhandledRejection', onRej)
    try {
      const { d } = await boot({ settings: { navLabels: undefined } })
      expect(await screen.findByTestId('shell-rail')).toHaveAttribute('data-expanded', 'true')
      await new Promise(r => setTimeout(r, 60))
      expect(seen).toEqual([])
      expect((await getSettings(d)).navLabels).toBeUndefined() // the write did fail
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('rail-label'), expect.any(Error)) // logged, not swallowed
    } finally {
      warn.mockRestore()
      process.off('unhandledRejection', onRej)
    }
  })
})

describe('shell: palette', () => {
  it('lists the target ticket even when hundreds of tickets share the word', async () => {
    const many = Array.from({ length: 450 }, (_, i) => mkTicket({ id: `bulk${i}`, title: `Watch lecture ${i}` }))
    await boot({ extra: many })
    fireEvent.click(await screen.findByTestId('shell-search'))
    const input = await screen.findByTestId('shell-palette-input')
    fireEvent.change(input, { target: { value: 'watch' } })
    const targets = screen.getAllByTestId('shell-palette-item').map(i => i.getAttribute('data-target'))
    expect(targets).toContain('/do/bulk449')
    expect(targets).toContain('/do/open1')
    expect(targets.length).toBeGreaterThanOrEqual(451)
  })

  it('reports aria-expanded and aria-controls truthfully: a list when there are results, neither when there are none', async () => {
    await boot()
    fireEvent.click(await screen.findByTestId('shell-search'))
    const input = await screen.findByTestId('shell-palette-input')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const list = document.getElementById(input.getAttribute('aria-controls')!)
    expect(list).not.toBeNull()
    expect(list).toHaveAttribute('role', 'listbox')
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'zzzqq' } })
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(input).not.toHaveAttribute('aria-controls')
    expect(input).not.toHaveAttribute('aria-activedescendant')
    expect(document.getElementById('pal-list')).toBeNull()
  })
})

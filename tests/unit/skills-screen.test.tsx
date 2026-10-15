import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../../src/data/types'
import { NARROW_QUERY } from '../../src/lib/useMediaQuery'
import { Skills } from '../../src/screens/Skills'
import { freshDb } from '../helpers/db'
import { appPlans, mkAiTickets, mkTicket } from '../helpers/planV2'
import { renderWithApp } from '../helpers/render'

const quest = vi.hoisted(() => ({ ticketId: 'ai.l3.learn' as string | null }))
const ro = vi.hoisted(() => ({ on: false }))
vi.mock('../../src/data/writer', async importOriginal => ({ ...(await importOriginal<typeof import('../../src/data/writer')>()), isReadOnly: () => ro.on }))
vi.mock('../../src/data/flatHooks', () => ({
  useTodayModel: () => {
    const t = quest.ticketId ? { id: quest.ticketId, kind: 'watch', title: 'Watch ai.l3.learn', estMin: 30 } : null
    return { next: t ? { kind: 'start', ticket: t, reason: '' } : { kind: 'wait', ticket: null, reason: '' }, mix: {}, pathNote: null, budgets: [], careerLane: false, dueReviews: 0, pick: { doing: [], lanes: [] } }
  },
}))

const plans = appPlans()
function phone(on: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q === NARROW_QUERY, media: q, addEventListener() {}, removeEventListener() {} }))
}
afterEach(() => { vi.unstubAllGlobals(); quest.ticketId = 'ai.l3.learn'; ro.on = false })

async function setup(route: string, sessions: Session[] = [], opts: { planOver?: Parameters<typeof appPlans>[0]; extra?: ReturnType<typeof mkAiTickets> } = {}) {
  const d = freshDb()
  await d.settings.put({ id: 'main', startDate: '2026-11-02', planVersion: 't', aiProviders: {}, possibleXp: 0, coreMinutes: 960 })
  await d.tickets.bulkPut([...mkAiTickets(), ...(opts.extra ?? [])])
  if (sessions.length) await d.sessions.bulkPut(sessions)
  // /do/<id> and the rest of the app are not under test: a catch-all keeps a Start's navigation from warning
  renderWithApp(<Routes><Route path="/skills/*" element={<Skills />} /><Route path="*" element={null} /></Routes>, { db: d, ...(opts.planOver ? appPlans(opts.planOver) : plans), route })
  return d
}

describe('Skills area map', () => {
  it('has the AI and Stats tabs, one tile per area with tag, 4 px stripe and a minutes meter', async () => {
    await setup('/skills')
    expect(await screen.findByTestId('skills-tabs')).toBeInTheDocument()
    expect(screen.getByTestId('skills-tab-ai')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('skills-tab-stats')).toHaveAttribute('aria-selected', 'false')
    const tiles = screen.getAllByTestId(/^skills-area-[a-z]+$/)
    expect(tiles).toHaveLength(10)
    expect(tiles[0]).toHaveAttribute('data-testid', 'skills-area-llm')
    expect(screen.getByTestId('skills-area-tag-llm')).toHaveTextContent('LL')
    expect(screen.getByTestId('skills-area-stripe-llm')).toBeInTheDocument()
    const meter = screen.getByTestId('skills-area-meter-llm')
    expect(meter).toHaveAttribute('data-done', '60')
    expect(meter).toHaveAttribute('data-total', '225')
    expect(meter).toHaveAttribute('aria-valuenow', '60')
    expect(meter).toHaveAttribute('aria-valuemax', '225')
    expect(screen.getByTestId('skills-area-meter-lead')).toHaveAttribute('data-total', '0')
  })

  it('scales the map down to the width it is given instead of scrolling (a 148 px rail leaves 1132 px)', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1132)
    try {
      await setup('/skills')
      await screen.findByTestId('skills-summary')
      const map = document.querySelector('.sk-amap') as HTMLElement
      await waitFor(() => expect(Number(map.dataset.scale)).toBeCloseTo(1132 / 1160, 3))
      expect(map.style.transform).toMatch(/^scale\(0\.97/)
      expect((document.querySelector('.sk-mapfit') as HTMLElement).style.width).toBe(`${1160 * (1132 / 1160)}px`)
    } finally { width.mockRestore() }
  })

  it('review D6: the area graph never scales below 1 (14 px node text stays 14 px); a narrow box scrolls sideways instead', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
    try {
      await setup('/skills/area/llm')
      await screen.findByTestId('skills-area-view')
      const view = document.querySelector('.sk-aview') as HTMLElement
      await waitFor(() => expect(view.dataset.scale).toBe('1.000'))
      expect(view.style.transform).toBe('')
      expect(document.querySelector('.sk-scroll')).not.toBeNull() // the box that scrolls (overflow-x: auto in skills.css)
    } finally { width.mockRestore() }
  })

  it('states the summary, the legend and each area state in words', async () => {
    await setup('/skills')
    expect(await screen.findByTestId('skills-summary')).toHaveTextContent('2 of 8 topics done · pick an area to open it')
    expect(screen.getByTestId('skills-legend')).toHaveTextContent(/Open.*In progress.*Needs another area/s)
    expect(screen.getByTestId('skills-area-llm')).toHaveAttribute('data-state', 'in-progress')
    expect(screen.getByTestId('skills-area-measure')).toHaveAttribute('data-state', 'open')
    expect(screen.getByTestId('skills-area-sched')).toHaveAttribute('data-state', 'needs-area')
    expect(screen.getByTestId('skills-area-llm')).toHaveAccessibleName('How LLMs run, In progress')
    expect(screen.getByTestId('skills-area-sched')).toHaveAccessibleName(/, Needs another area$/)
  })

  it('marks plan-authored names data-content="plan" (name, needs list) and leaves the tile and its app words unmarked', async () => {
    await setup('/skills')
    const tile = await screen.findByTestId('skills-area-sched')
    expect(tile).not.toHaveAttribute('data-content')
    expect(within(tile).getByText('Measuring things').closest('[data-content="plan"]')).not.toBeNull()
    expect(within(tile).getByText('Measuring things')).toHaveAttribute('data-content', 'plan')
  })

  it('draws exactly one arrow per area prerequisite and marks met gates', async () => {
    await setup('/skills')
    await screen.findByTestId('skills-summary')
    const edges = screen.getAllByTestId(/^skills-edge-/)
    expect(edges).toHaveLength(12) // sched 2, state 1, linux 1, agents 1, fleet 2, safe 3, lead 2
    expect(screen.getByTestId('skills-edge-llm-sched')).toHaveAttribute('data-met', 'true')
    expect(screen.getByTestId('skills-edge-measure-sched')).toHaveAttribute('data-met', 'false')
    expect(edges[0].tagName.toLowerCase()).toBe('path')
  })

  it('opens an area from a tile', async () => {
    await setup('/skills')
    fireEvent.click(await screen.findByTestId('skills-area-llm'))
    expect(screen.getByTestId('location')).toHaveTextContent('/skills/area/llm')
    expect(await screen.findByTestId('skills-area-view')).toHaveTextContent(/How LLMs run/)
    expect(screen.getByTestId('skills-area-view')).toHaveTextContent('2 of 5 topics')
    expect(screen.getByTestId('skills-area-view')).toHaveTextContent('LL')
    fireEvent.click(screen.getByTestId('skills-all-areas'))
    expect(screen.getByTestId('location')).toHaveTextContent('/skills')
    expect(screen.getByTestId('location')).not.toHaveTextContent('/skills/area')
  })

  it('switches between the AI and Stats tabs', async () => {
    await setup('/skills')
    fireEvent.click(await screen.findByTestId('skills-tab-stats'))
    expect(screen.getByTestId('location')).toHaveTextContent('/skills/stats')
    expect(await screen.findByTestId('skills-stats')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('skills-tab-ai'))
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/skills$/)
  })

  it('shows skills-empty with data-empty when the plan has no areas', async () => {
    await setup('/skills', [], { planOver: { areas: [], nodes: [] } })
    const empty = await screen.findByTestId('skills-empty')
    expect(empty).toHaveAttribute('data-empty', 'true')
    expect(within(empty).getAllByRole('link')).toHaveLength(1)
  })

  it('stays read-only: browsing changes nothing', async () => {
    const d = await setup('/skills')
    const before = JSON.stringify(await d.tickets.toArray())
    const settingsBefore = JSON.stringify(await d.settings.toArray())
    fireEvent.click(await screen.findByTestId('skills-area-llm'))
    fireEvent.click(await screen.findByTestId('skills-node-L4'))
    fireEvent.click(screen.getByTestId('skills-all-areas'))
    expect(JSON.stringify(await d.tickets.toArray())).toBe(before)
    expect(JSON.stringify(await d.settings.toArray())).toBe(settingsBefore)
    expect(await d.events.count()).toBe(0)
  })
})

describe('Skills area view', () => {
  it('draws every node of the area with its contract state', async () => {
    await setup('/skills/area/llm')
    await screen.findByTestId('skills-area-view')
    const want: Record<string, string> = { L1: 'done', L2: 'done', L3: 'next', L4: 'locked', R1: 'available' }
    expect(screen.getAllByTestId(/^skills-node-[A-Z]\d$/)).toHaveLength(5)
    // SKILLS-09: every other skills-node-* hook is one of the contract's (glyph, meter, note, edge, panel, start); the legend is not one of them
    const hooks = [...document.querySelectorAll('[data-testid^="skills-node-"]')].map(e => e.getAttribute('data-testid')!)
    const known = /^skills-node-(glyph|meter|note|edge)-|^skills-node-(panel|start)$|^skills-node-[A-Z]\d$/
    expect(hooks.filter(h => !known.test(h))).toEqual([])
    for (const [id, st] of Object.entries(want)) expect(screen.getByTestId(`skills-node-${id}`)).toHaveAttribute('data-state', st)
    expect(screen.getByTestId('skills-node-L3')).toHaveAccessibleName('How an LLM is made, Next')
    expect(screen.getByTestId('skills-node-meter-L3')).toHaveAttribute('aria-valuemax', '2')
    expect(screen.getByTestId('skills-node-meter-L1')).toHaveAttribute('aria-valuenow', '1')
    expect(screen.getByTestId('skills-node-meter-L1')).toHaveAttribute('data-done', '1')
    expect(screen.getByTestId('skills-node-meter-L1')).toHaveAttribute('data-total', '1')
  })

  it('renders nodes as SVG groups with role=button and tabindex, never <button> elements (R9)', async () => {
    await setup('/skills/area/llm')
    await screen.findByTestId('skills-area-view')
    for (const id of ['L1', 'L2', 'L3', 'L4', 'R1']) {
      const n = screen.getByTestId(`skills-node-${id}`)
      expect(n.tagName.toLowerCase()).toBe('g')
      expect(n).toHaveAttribute('role', 'button')
      expect(n).toHaveAttribute('tabindex', '0')
      expect(n).not.toHaveAttribute('data-content') // only the title span inside is plan text
      expect(within(n).getByText(/./, { selector: '[data-content="plan"]' })).toBeInTheDocument()
    }
    expect([...document.querySelectorAll('button')].filter(b => /^skills-node-[A-Z]\d$/.test(b.getAttribute('data-testid') ?? ''))).toHaveLength(0)
    expect(screen.getByTestId('skills-node-L3').closest('button')).toBeNull()
  })

  it('gives each node a state glyph span whose data-glyph names the state', async () => {
    await setup('/skills/area/llm', [], { extra: [] })
    await screen.findByTestId('skills-area-view')
    const want: Record<string, string> = { L1: 'check', L2: 'check', L3: 'next', L4: 'lock', R1: 'open' }
    for (const [id, glyph] of Object.entries(want)) {
      const g = screen.getByTestId(`skills-node-glyph-${id}`)
      expect(g.tagName).toBe('SPAN')
      expect(g).toHaveAttribute('data-glyph', glyph)
      expect(screen.getByTestId(`skills-node-${id}`).querySelector('[data-glyph]')).toBe(g)
    }
  })

  it('shows the progress glyph for an in-progress node', async () => {
    const d = await setup('/skills/area/llm')
    await d.tickets.update('ai.r1.build', { status: 'doing' })
    await waitFor(() => expect(screen.getByTestId('skills-node-R1')).toHaveAttribute('data-state', 'inprog'))
    expect(screen.getByTestId('skills-node-glyph-R1')).toHaveAttribute('data-glyph', 'progress')
    expect(screen.getByTestId('skills-node-R1')).toHaveAccessibleName(/, In progress$/)
  })

  it('draws one arrow per prerequisite inside the area, prerequisite first', async () => {
    await setup('/skills/area/llm')
    await screen.findByTestId('skills-area-view')
    expect(screen.getAllByTestId(/^skills-node-edge-/).map(e => e.getAttribute('data-testid')!.replace('skills-node-edge-', '')).sort())
      .toEqual(['L1-L2', 'L1-R1', 'L2-L3', 'L3-L4'])
  })

  it('has exactly one next node, and none when the quest has no node', async () => {
    await setup('/skills/area/llm')
    await screen.findByTestId('skills-area-view')
    expect(document.querySelectorAll('[data-state="next"]')).toHaveLength(1)
  })

  it('has no next node when Today has no quest ticket', async () => {
    quest.ticketId = null
    await setup('/skills/area/llm')
    await screen.findByTestId('skills-area-view')
    expect(document.querySelectorAll('[data-state="next"]')).toHaveLength(0)
  })

  it('draws no note under a locked node on the map; the panel names what is recommended first (AI maps use the tree layout)', async () => {
    await setup('/skills/area/llm')
    await screen.findByTestId('skills-area-view')
    expect(document.querySelector('[data-testid^="skills-node-note-"]')).toBeNull()
    expect(screen.getByTestId('skills-node-L4')).toHaveAttribute('data-state', 'locked')
    fireEvent.click(screen.getByTestId('skills-node-L4'))
    const panel = screen.getByTestId('skills-node-panel')
    expect(panel).toHaveTextContent('Needs first')
    expect(panel).toHaveTextContent('How an LLM is made')
  })

  it('keeps the Needs first and Unlocks headings when a topic has neither', async () => {
    await setup('/skills/area/llm')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-L1'))
    const panel = screen.getByTestId('skills-node-panel')
    expect(panel).toHaveTextContent('Needs first')
    expect(within(panel).getByTestId('skills-panel-needs-none')).toBeInTheDocument()
    expect(panel).toHaveTextContent('Unlocks')
    fireEvent.click(screen.getByTestId('skills-node-R1'))
    expect(screen.getByTestId('skills-node-panel')).toHaveTextContent('Unlocks')
    expect(within(screen.getByTestId('skills-node-panel')).getByTestId('skills-panel-unlocks-none')).toBeInTheDocument()
  })

  it('says tickets are written before phase N for nodes of an unwritten phase', async () => {
    await setup('/skills/area/sched')
    await screen.findByTestId('skills-area-view')
    expect(screen.queryByTestId('skills-node-note-S1')).toBeNull()
    expect(screen.getByTestId('skills-node-S1')).toHaveAttribute('data-state', 'locked')
    fireEvent.click(screen.getByTestId('skills-node-S1'))
    expect(screen.getByTestId('skills-node-panel')).toHaveTextContent(/tickets written before phase 2/i)
    expect(screen.getByTestId('skills-node-panel')).toHaveTextContent('Tickets 0 of 0')
    expect(screen.getByTestId('skills-node-meter-S1')).toHaveAttribute('data-total', '0')
    expect(screen.queryByTestId('skills-node-start')).toBeNull()
  })

  it('opens the panel for the selected node with prerequisites, unlocks, progress and one accent start', async () => {
    const d = await setup('/skills/area/llm')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-L3'))
    const panel = screen.getByTestId('skills-node-panel')
    expect(screen.getByTestId('skills-node-L3')).toHaveAttribute('aria-current', 'true')
    expect(panel).toHaveTextContent('How an LLM is made')
    expect(panel).toHaveTextContent('Needs first')
    expect(within(panel).getByText('Transformers and attention')).toBeInTheDocument()
    expect(panel).toHaveTextContent('Unlocks')
    expect(within(panel).getByText('How inference works')).toBeInTheDocument()
    expect(panel).toHaveTextContent('Tickets 0 of 2')
    const start = screen.getByTestId('skills-node-start')
    expect(start).toHaveTextContent(/^START · WATCH$/i)
    expect(start).toHaveAttribute('data-accent', 'primary')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
    fireEvent.click(start)
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/do/ai.l3.learn'))
    await waitFor(async () => expect((await d.tickets.get('ai.l3.learn'))!.status).toBe('doing'))
  })

  it('keeps the selection in component state: the URL never gains a query', async () => {
    await setup('/skills/area/llm')
    await screen.findByTestId('skills-area-view')
    fireEvent.click(screen.getByTestId('skills-node-L2'))
    expect(screen.getByTestId('skills-node-L2')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('skills-node-L3')).not.toHaveAttribute('aria-current')
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/skills\/area\/llm$/)
    expect(screen.getByTestId('location')).toHaveAttribute('data-search', '')
  })

  it('selects a node with Enter and Space', async () => {
    await setup('/skills/area/llm')
    await screen.findByTestId('skills-area-view')
    fireEvent.keyDown(screen.getByTestId('skills-node-L4'), { key: 'Enter' })
    expect(screen.getByTestId('skills-node-L4')).toHaveAttribute('aria-current', 'true')
    fireEvent.keyDown(screen.getByTestId('skills-node-R1'), { key: ' ' })
    expect(screen.getByTestId('skills-node-R1')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('skills-node-panel')).toHaveTextContent('Run a real model')
  })

  it('lets a soft-locked node start its ticket', async () => {
    await setup('/skills/area/llm')
    fireEvent.click(await screen.findByTestId('skills-node-L4'))
    expect(screen.getByTestId('skills-node-start')).toBeEnabled()
    expect(screen.getByTestId('skills-node-panel').textContent).not.toMatch(/blocked|forbidden|unlock by/i)
  })

  it('read-only: Start is disabled and nothing is written', async () => {
    ro.on = true
    const d = await setup('/skills/area/llm')
    const before = JSON.stringify(await d.tickets.toArray())
    fireEvent.click(await screen.findByTestId('skills-node-L3'))
    const start = screen.getByTestId('skills-node-start')
    expect(start).toBeDisabled()
    fireEvent.click(start)
    expect(screen.getByTestId('location')).toHaveTextContent('/skills/area/llm')
    expect(JSON.stringify(await d.tickets.toArray())).toBe(before)
    expect(await d.events.count()).toBe(0)
    expect(await d.sessions.count()).toBe(0)
  })

  it('sends an unknown area back to the map', async () => {
    await setup('/skills/area/nope')
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/skills$/))
  })
})

describe('Skills on a phone', () => {
  it('lists the areas as tiles without arrows', async () => {
    phone(true)
    await setup('/skills')
    expect(await screen.findAllByTestId(/^skills-area-[a-z]+$/)).toHaveLength(10)
    expect(screen.queryAllByTestId(/^skills-edge-/)).toHaveLength(0)
  })

  it('shows an area as an indented tree with expandable rows and a next-ticket panel', async () => {
    phone(true)
    await setup('/skills/area/llm')
    const tree = await screen.findByTestId('skills-list')
    expect(tree).toHaveAttribute('role', 'tree')
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(5)
    expect(screen.queryByTestId('skills-node-L1')).toBeNull() // no graph on a phone
    const rows = within(tree).getAllByRole('treeitem')
    const pad = (el: HTMLElement) => parseInt(el.style.paddingLeft, 10)
    expect(pad(rows[1]) - pad(rows[0])).toBeGreaterThanOrEqual(16)
    expect(pad(rows[1]) - pad(rows[0])).toBeLessThanOrEqual(20)
    rows[0].focus()
    fireEvent.keyDown(rows[0], { key: 'ArrowDown' })
    expect(rows[1]).toHaveFocus()
    fireEvent.keyDown(rows[1], { key: 'ArrowRight' })
    expect(rows[1]).toHaveAttribute('aria-expanded', 'true')
    fireEvent.keyDown(rows[1], { key: 'ArrowLeft' })
    expect(rows[1]).toHaveAttribute('aria-expanded', 'false')
    const next = screen.getByTestId('skills-next-panel')
    expect(next).toHaveTextContent('Watch ai.l3.learn')
    expect(next.querySelector('[data-accent="primary"]')).not.toBeNull()
    expect(screen.getByTestId('skills-next-start')).toHaveAttribute('data-accent', 'primary')
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
  })

  it('carries data-layer and the glyph hook on every row; an expanded row has a Start without data-accent', async () => {
    phone(true)
    await setup('/skills/area/llm')
    await screen.findByTestId('skills-list')
    const layers: Record<string, string> = { L1: '0', L2: '1', L3: '2', L4: '3', R1: '1' }
    for (const [id, layer] of Object.entries(layers)) {
      expect(screen.getByTestId(`skills-row-${id}`)).toHaveAttribute('data-layer', layer)
      expect(screen.getByTestId(`skills-node-glyph-${id}`).tagName).toBe('SPAN')
      expect(screen.getByTestId(`skills-node-meter-${id}`)).toHaveAttribute('data-total')
    }
    expect(screen.getByTestId('skills-node-glyph-L3')).toHaveAttribute('data-glyph', 'next')
    expect(screen.getByTestId('skills-node-glyph-L4')).toHaveAttribute('data-glyph', 'lock')
    const pad = (id: string) => parseInt(screen.getByTestId(`skills-row-${id}`).style.paddingLeft, 10)
    expect(pad('L2') - pad('L1')).toBe(18)
    expect(pad('R1')).toBe(pad('L2'))
    fireEvent.keyDown(screen.getByTestId('skills-row-L4'), { key: 'ArrowRight' })
    const start = within(screen.getByTestId('skills-row-L4')).getByTestId('skills-node-start')
    expect(start).not.toHaveAttribute('data-accent')
    expect(within(screen.getByTestId('skills-row-L4')).getByText('How inference works, in one line.')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-accent="primary"]')).toHaveLength(1)
  })

  it('opens a row by tapping it and starts that ticket', async () => {
    phone(true)
    const d = await setup('/skills/area/llm')
    const row = await screen.findByTestId('skills-row-R1')
    fireEvent.click(within(row).getByText('Run a real model'))
    expect(row).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(within(row).getByTestId('skills-node-start'))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/do/ai.r1.build'))
    await waitFor(async () => expect((await d.tickets.get('ai.r1.build'))!.status).toBe('doing'))
  })

  it('keeps the next-ticket panel off an area that does not hold the next node', async () => {
    phone(true)
    await setup('/skills/area/measure')
    await screen.findByTestId('skills-list')
    expect(screen.queryByTestId('skills-next-panel')).toBeNull()
  })

  it('read-only: the next-ticket Start is disabled', async () => {
    ro.on = true
    phone(true)
    await setup('/skills/area/llm')
    expect(await screen.findByTestId('skills-next-start')).toBeDisabled()
  })

  it('the stylesheet fixes the next panel above the 68 px tab bar instead of sticking it', () => {
    const css = readFileSync(`${process.cwd()}/src/screens/skills.css`, 'utf8')
    expect(css).toMatch(/\.sk-nextpanel\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*76px/)
    // the desktop node panel may stick (min-width media); the phone next panel never does
    expect(css).not.toMatch(/\.sk-nextpanel[^{]*\{[^}]*position:\s*sticky/)
  })
})

describe('Skills Stats', () => {
  it('selects the Stats tab on a trailing slash too', async () => {
    await setup('/skills/stats/')
    expect(await screen.findByTestId('skills-stats')).toBeInTheDocument()
    expect(screen.getByTestId('skills-tab-stats')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('skills-tab-ai')).toHaveAttribute('aria-selected', 'false')
  })

  const s = (id: string, daysAgo: number, minutes: number): Session => ({ id, ticketId: 'ai.l1.learn', start: Date.now() - daysAgo * 86_400_000, end: Date.now(), minutes, outcome: 'solved', xpDelta: 0 })

  it('shows done and total minutes, one row per lane and a pace line without a verdict', async () => {
    await setup('/skills/stats', [s('a', 1, 30), s('b', 3, 20), s('c', 40, 99)])
    expect(await screen.findByTestId('skills-stats')).toBeInTheDocument()
    expect(screen.getByTestId('skills-stats-done-min')).toHaveTextContent(/^60$/)
    expect(screen.getByTestId('skills-stats-total-min')).toHaveTextContent(/^255$/)
    expect(screen.getByTestId('skills-stats-lane-path')).toHaveAttribute('data-total', '255')
    for (const l of ['dsa', 'design']) expect(screen.getByTestId(`skills-stats-lane-${l}`)).toHaveAttribute('data-total', '0')
    expect(screen.getByTestId('skills-stats-pace').textContent).toBe('50 of 960 min in the last 14 days')
    expect(screen.getByTestId('skills-stats-pace').textContent).not.toMatch(/behind|late|overdue|missed/i)
    expect(screen.getByTestId('skills-tab-stats')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('skills-tab-ai')).toHaveAttribute('aria-selected', 'false')
  })

  it('counts every non-archived ticket in the total, including other lanes', async () => {
    const d = await setup('/skills/stats')
    await d.tickets.put(mkTicket({ id: 'dsa-x', lane: 'dsa', kind: 'problem', estMin: 40 }))
    await waitFor(() => expect(screen.getByTestId('skills-stats-total-min')).toHaveTextContent(/^295$/))
  })

  it('folds bank tickets into the DSA row and shows no bank row', async () => {
    await setup('/skills/stats', [], { extra: [mkTicket({ id: 'bk', origin: 'bank:neetcode', lane: 'bank', kind: 'problem', estMin: 25, status: 'done' }), mkTicket({ id: 'dsa-y', lane: 'dsa', kind: 'problem', estMin: 15 })] })
    await waitFor(() => expect(screen.getByTestId('skills-stats-lane-dsa')).toHaveAttribute('data-total', '40'))
    expect(screen.getByTestId('skills-stats-lane-dsa')).toHaveAttribute('data-done', '25')
    expect(screen.queryByTestId('skills-stats-lane-bank')).toBeNull()
    expect(screen.getByTestId('skills-stats-total-min')).toHaveTextContent(/^295$/)
  })

  it('does not count archived tickets', async () => {
    const d = await setup('/skills/stats')
    await d.tickets.put(mkTicket({ id: 'gone', estMin: 99, archived: true }))
    await screen.findByTestId('skills-stats-total-min')
    expect(screen.getByTestId('skills-stats-total-min')).toHaveTextContent(/^255$/)
  })

  it('reads 960 when no core minutes are stored', async () => {
    const d = await setup('/skills/stats')
    await d.settings.update('main', { coreMinutes: undefined })
    await waitFor(() => expect(screen.getByTestId('skills-stats-pace').textContent).toBe('0 of 960 min in the last 14 days'))
  })
})
